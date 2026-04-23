import {
  IntervalDescriptor, PatternTypes, Progress, Scanner, ScannerOptions, ScannerFactory
} from '../scanner.js';
import { Any } from './any.js';
import { Event } from '../../event.js';
import { PriorityBlockedQueue } from '../priorityblockedqueue.js';

export class Not implements Scanner {

  id: string;

  private any: Any;
  private eventQueue: PriorityBlockedQueue;
  private reader: Generator<{ blocked: boolean, event: Event }>;
  private toEmit: Event[];
  private lastEmitted: Event;

  private matched: boolean;
  private descriptors: Map<string, IntervalDescriptor>;
  private toInclude: Set<string>;

  constructor(conditions: PatternTypes[], options: ScannerOptions = {}) {
    this.id = options.id ?? (
      conditions.map(condition => typeof condition === 'string' ?
        condition : condition.name
      ).join('||'));

    this.any = new Any(conditions);
    this.eventQueue = new PriorityBlockedQueue({ start: options.start });
    this.reader = this.eventQueue.reader();
    this.toEmit = [];

    this.matched = false;
    this.toInclude = new Set();
    this.descriptors = new Map();

    conditions.forEach(condition => {
      if (typeof condition === 'string') this.toInclude.add(condition);
      else this.descriptors.set(condition.name, condition);
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

  private startEvent(position: number) {
    return Event.start(`not:${this.id}`, position, {
      source: `not:${this.id}`,
      operation: `not`,
      arguments: Array.from<PatternTypes>(this.toInclude).concat(Array.from(this.descriptors.values()))
    });
  }

  private endEvent(position: number) {
    return Event.end(`not:${this.id}`, position);
  }

  reindex(newIndex: number): void {
    if (Object.keys(this.eventQueue.watermarks).length > 0)
      this.eventQueue.reindexWatermark(newIndex);
    this.any.reindex(newIndex);
  }

  shift(event: Event): Progress {
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
        const result = this.any.shift(curEvent);
        if (result.values === undefined) {
          if (!this.matched) {
            this.matched = true;
            this.toEmit.push(this.startEvent(curEvent.position));
            this.eventQueue.reindexWatermark(this.lastreceived);
          }
          this.toEmit.push(curEvent);
        } else {
          result.values.forEach(emitted => {
            switch (emitted.kind) {
              case 'start':
                if (emitted.name === `any:${this.id}`) {
                  this.eventQueue.reindexWatermark(this.lastreceived + 1);
                  if (this.matched) {
                    this.toEmit.push(this.endEvent(emitted.position - 1));
                    this.matched = false;
                  }
                } else {
                  this.eventQueue.reindexWatermark(this.lastreceived + 1);
                }
                break;
              case 'end':
                if (emitted.name === `any:${this.id}`) {
                  this.matched = true;
                  this.toEmit.push(this.startEvent(curEvent.position));
                  this.toEmit.push(curEvent);
                  this.eventQueue.reindexWatermark(this.eventQueue.minSmallIndex);
                } else {
                  this.eventQueue.reindexWatermark(this.lastreceived + 1);
                }
                break;
              case 'token':
                this.eventQueue.reindexWatermark(this.lastreceived + 1);
                break;
            }
          });
        }
      }

      finished = iterated.done || iterated.value.blocked;
    } while (!finished);

    return this.getReturnValue();
  }

  static factory(conditions: PatternTypes[]): ScannerFactory {
    const id = conditions.map(c => typeof c === 'string' ? c : c.name).join('||');
    return {
      name: `not:${id}`,
      terms: [],
      create: (options) => new Not(conditions, options)
    };
  }
}
