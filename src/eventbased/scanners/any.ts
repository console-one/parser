import {
  PatternTypes, IntervalDescriptor, Scanner, Progress, EventPredicate,
  ScannerOptions, ScannerFactory
} from '../scanner.js';
import { PriorityBlockedQueue } from '../priorityblockedqueue.js';
import { Event } from '../../event.js';

export class Any implements Scanner {

  id: string;

  private eventQueue: PriorityBlockedQueue;
  private reader: Generator<{ blocked: boolean, event: Event }>;

  private matched: boolean;
  private inInterval: boolean;
  private toEmit: Event[];
  private lastEmitted: Event;

  private toInclude: Set<string>;
  private descriptors: Map<string, IntervalDescriptor>;
  private startPredicates: Map<string, EventPredicate>;
  private endPredicates: Map<string, EventPredicate>;

  constructor(conditions: PatternTypes[], options: ScannerOptions = {}) {
    this.id = options.id ?? (
      conditions.map(condition => typeof condition === 'string' ?
        condition : condition.name
      ).join('||'));

    this.eventQueue = new PriorityBlockedQueue({ start: options.start });
    this.reader = this.eventQueue.reader();

    this.matched = false;
    this.inInterval = false;
    this.toEmit = [];

    this.toInclude = new Set();
    this.descriptors = new Map();
    this.startPredicates = new Map();
    this.endPredicates = new Map();
    conditions.forEach(condition => {
      if (typeof condition === 'string') {
        this.toInclude.add(condition);
      } else {
        this.descriptors.set(condition.name, condition);
        this.startPredicates.set(condition.name, condition.matchStart());
      }
    });
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

  private getReturnValue(): Progress {
    const returnValue: Progress = {
      closed: this.lastclosed,
      done: this.complete
    };
    if (this.toEmit.length > 0) {
      returnValue.values = this.toEmit.map(v => v);
      this.lastEmitted = this.toEmit[this.toEmit.length - 1];
      this.toEmit = [];
      if (this.matched === false) returnValue.closed -= 1;
    }
    return returnValue;
  }

  private validateInput(event: Event) {
    if (this.eventQueue.completedWrite) {
      console.error(`Attempted to feed event `, event, ` into any scanner: `, this);
      console.error(`But any scanner has already received a closing signal. Event queue: `, this.eventQueue);
      throw new Error(`Multiple close events submitted to the same input scanner!`);
    }
  }

  private startEvent(position: number) {
    return Event.start(`any:${this.id}`, position, {
      source: `any:${this.id}`,
      operation: `any`,
      arguments: Array.from<PatternTypes>(this.toInclude).concat(Array.from(this.descriptors.values()))
    });
  }

  private endEvent(position: number) {
    return Event.end(`any:${this.id}`, position);
  }

  reindex(newIndex: number): void {
    if (Object.keys(this.eventQueue.watermarks).length > 0)
      this.eventQueue.reindexWatermark(newIndex);
  }

  shift(event: Event): Progress {
    this.validateInput(event);
    this.eventQueue.push(event);

    let finished: boolean;
    do {
      const iterated = this.reader.next();
      if (iterated.done) {
        this.eventQueue.removeWatermark();
        this.eventQueue.dequeue();
        if (this.matched) {
          this.toEmit.push(this.endEvent(this.lastEmitted.position));
          this.matched = false;
        }
      } else {
        const curEvent = iterated.value.event;
        if (this.inInterval) {
          this.toEmit.push(curEvent);
          if (event instanceof Event.End) {
            for (const key of this.endPredicates.keys()) {
              if (this.endPredicates.get(key)(curEvent)) {
                this.toEmit.push(this.endEvent(curEvent.position));
                this.inInterval = false;
                break;
              }
            }
          }
        } else {
          if (curEvent instanceof Event.Token) {
            if (this.toInclude.has(curEvent.data)) {
              if (!this.matched) {
                this.eventQueue.reindexWatermark(this.lastreceived);
                this.toEmit.push(this.startEvent(curEvent.position));
                this.matched = true;
              }
              this.toEmit.push(curEvent);
            } else {
              this.eventQueue.reindexWatermark(this.lastreceived + 1);
              if (this.matched) {
                this.toEmit.push(this.endEvent(curEvent.position - 1));
                this.matched = false;
              }
            }
          } else if (curEvent instanceof Event.Start) {
            let found = false;
            for (const key of this.startPredicates.keys()) {
              if (this.startPredicates.get(key)(curEvent)) {
                const descriptor = this.descriptors.get(key);
                this.endPredicates.set(key, descriptor.buildEnd(curEvent));
                this.inInterval = true;
                if (!this.matched) {
                  this.eventQueue.reindexWatermark(this.lastreceived);
                  this.matched = true;
                  this.toEmit.push(this.startEvent(curEvent.position));
                }
                this.toEmit.push(curEvent);
                found = true;
                break;
              }
            }
            if (!found) this.eventQueue.reindexWatermark(this.lastreceived + 1);
            if (!found && this.matched) {
              this.toEmit.push(this.endEvent(curEvent.position - 1));
              this.matched = false;
            }
          } else if (curEvent instanceof Event.End) {
            this.eventQueue.reindexWatermark(this.lastreceived + 1);
            if (this.matched) {
              this.toEmit.push(this.endEvent(curEvent.position));
              this.matched = false;
            }
          }
        }
      }
      finished = iterated.done || iterated.value.blocked;
    } while (!finished);

    return this.getReturnValue();
  }

  static factory(conditions: PatternTypes[]): ScannerFactory {
    const id = conditions.map(c => typeof c === 'string' ? c : c.name).join('||');
    return {
      name: `any:${id}`,
      terms: [],
      create: (options) => new Any(conditions, options)
    };
  }
}
