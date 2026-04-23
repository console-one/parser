import {
  NamedPatternTypes, PatternTypes, IntervalDescriptor, Scanner, Progress,
  EventPredicate, ScannerOptions, ScannerFactory
} from '../scanner.js';
import { PriorityBlockedQueue } from '../priorityblockedqueue.js';
import { Event } from '../../event.js';

/**
 * Computes the Longest Prefix Suffix (LPS) array for a given pattern, used
 * by KMP-style matching.
 */
export function computeLPSArray(pat: string): number[] {
  let len = 0;
  let i = 1;
  const lps = new Array(pat.length);
  lps[0] = 0;
  while (i < pat.length) {
    if (pat.charAt(i) == pat.charAt(len)) {
      len++;
      lps[i] = len;
      i++;
    } else {
      if (len != 0) {
        len = lps[len - 1];
      } else {
        lps[i] = len;
        i++;
      }
    }
  }
  return lps;
}

export const UNICODE_MIN = 0;

export type AdjancencyTable = {
  patterns: [keyof NamedPatternTypes, PatternTypes][];
  rangeSymbols: { [key: string]: string };
  symbols: string[];
  lps: number[];
};

export const calculatePattern = (...inputs: (string | IntervalDescriptor)[]): AdjancencyTable => {
  let patterns: [keyof NamedPatternTypes, PatternTypes][] = [];
  const rangeSymbols: { [key: string]: string } = {};
  const charSymbols: { [key: number]: string } = {};

  for (const item of inputs) {
    if (typeof item === 'string') {
      patterns = item.split('').reduce((patternReduction, key) => {
        charSymbols[key.charCodeAt(0)] = key;
        patternReduction.push(['ATOMIC', key]);
        return patternReduction;
      }, patterns);
    } else {
      patterns.push(['RANGE', item]);
      rangeSymbols[item.name] = undefined;
    }
  }

  let charCode = UNICODE_MIN;
  let assigned = 0;
  const rangeNames = Array.from(Object.keys(rangeSymbols));
  while (assigned < rangeNames.length) {
    while (charSymbols[charCode] !== undefined) charCode += 1;
    rangeSymbols[rangeNames[assigned]] = String.fromCharCode(charCode);
    assigned += 1;
    charCode += 1;
  }

  const symbols: string[] = [];
  for (const item of patterns) {
    if (item[0] === 'ATOMIC') symbols.push(item[1] as string);
    else symbols.push(rangeSymbols[(item[1] as IntervalDescriptor).name]);
  }

  const lps = computeLPSArray(symbols.join(''));
  return { patterns, symbols, rangeSymbols, lps };
};

export class Match implements Scanner {

  id: string;

  private eventQueue: PriorityBlockedQueue;
  private head: Generator<{ blocked: boolean, event: Event }>;

  private inclusive: boolean;
  private pattern: Map<number,
    string | {
      descriptor: IntervalDescriptor;
      matchStart: EventPredicate;
      matchEnd?: EventPredicate;
    }>;
  private patternSize: number;
  private inInterval: boolean;
  private matched: number;

  constructor(pattern: (string | IntervalDescriptor)[], options: ScannerOptions & {
    inclusive?: boolean;
  } = {}) {
    this.id = options.id ?? pattern.map(component => typeof component === 'string' ?
      component : component.name
    ).join('');
    this.inclusive = (options as any).inclusive ?? true;

    this.eventQueue = new PriorityBlockedQueue({
      id: `match:${this.id}`,
      start: options.start
    });
    this.head = this.eventQueue.reader();

    this.matched = -1;
    this.inInterval = false;

    let index = 0;
    this.pattern = new Map();
    for (const component of pattern) {
      if (typeof component === 'string') {
        for (const char of component) {
          this.pattern.set(index, char);
          index++;
        }
      } else {
        this.pattern.set(index, { descriptor: component, matchStart: component.matchStart() });
        index++;
      }
    }
    this.patternSize = index - 1;
  }

  get complete(): boolean {
    return this.eventQueue.completedRead;
  }

  get lastclosed(): number {
    return this.eventQueue.closed;
  }

  get lastreceived(): number {
    return this.eventQueue.maxConsumedSmallIndex;
  }

  private computeOutputProgress(output: Event[]): Progress {
    const returnValue: Progress = {
      closed: this.eventQueue.closed,
      done: this.eventQueue.completedRead
    };
    if (output.length > 0) returnValue.values = output;
    return returnValue;
  }

  private reset() {
    this.matched = -1;
    this.eventQueue.removeWatermark();
    if (this.inclusive) this.eventQueue.dequeue(1);
    else this.eventQueue.dequeue();
    this.head = this.eventQueue.reader();
  }

  reindex(newIndex: number): void {
    this.matched = -1;
    this.eventQueue.reindexWatermark(newIndex);
  }

  private startEvent(position: number): Event.Start {
    return Event.start(`match:${this.id}`, position, {
      source: `match:${this.id}`,
      operation: 'match',
      arguments: Array.from(this.pattern.values()).map(component =>
        typeof component === 'string' ? component : component.descriptor
      )
    });
  }

  private endEvent(position: number): Event.End {
    return Event.end(`match:${this.id}`, position);
  }

  shift(event: Event): Progress {
    this.eventQueue.push(event);

    const output: Event[] = [];
    let finished: boolean;
    do {
      const iterated = this.head.next();
      if (iterated.done) {
        this.eventQueue.removeWatermark();
        this.eventQueue.dequeue();
      } else {
        const curEvent = iterated.value.event;
        if (this.inInterval) {
          if (curEvent instanceof Event.End) {
            const component = this.pattern.get(this.matched);
            if (typeof component !== 'string' && component.matchEnd(curEvent)) {
              this.inInterval = false;
              this.matched++;
              if (this.matched === this.pattern.size) {
                const events = Object.values(this.eventQueue.inQueue);
                output.push(this.startEvent(events[0].position));
                output.push(...events);
                output.push(this.endEvent(events[events.length - 1].position));
                this.reset();
              }
            }
          }
        } else {
          const component = this.pattern.get(this.matched + 1);
          if (curEvent instanceof Event.Token) {
            if (typeof component === 'string' && curEvent.data === component) {
              this.matched++;
              if (this.matched === this.patternSize) {
                const events = Object.values(this.eventQueue.inQueue);
                output.push(this.startEvent(events[0].position));
                output.push(...events);
                output.push(this.endEvent(events[events.length - 1].position));
                this.reset();
              }
            } else {
              this.reset();
            }
          } else if (curEvent instanceof Event.Start) {
            if (component === undefined) console.log(this);
            if (typeof component !== 'string' && component.matchStart(curEvent)) {
              this.matched++;
              this.inInterval = true;
              component.matchEnd = component.descriptor.buildEnd(curEvent);
            } else {
              this.reset();
            }
          } else if (curEvent instanceof Event.End) {
            this.reset();
          }
        }
      }
      finished = iterated.done || iterated.value.blocked;
      if (this.matched < 0 && Object.keys(this.eventQueue.inQueue).length > 0)
        finished = false;
    } while (!finished);

    return this.computeOutputProgress(output);
  }

  static factory(pattern: PatternTypes[]): ScannerFactory {
    const id = pattern.map(component => typeof component === 'string' ?
      component : component.name
    ).join('');

    return {
      name: `match:${id}`,
      terms: [],
      create: (options) => new Match(pattern, options)
    } as ScannerFactory;
  }
}
