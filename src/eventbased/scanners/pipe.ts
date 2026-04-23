import { Scanner, Progress, ScannerFactory, ScannerOptions } from '../scanner.js';
import { EventQueue } from '../eventqueue.js';
import { Event } from '../../event.js';

/**
 * Sends the output of one scanner to the input of another.
 */
export class Pipe implements Scanner {

  public id: string;
  public lastclosed: number;
  private eventQueue: EventQueue;
  private reader: Generator<{ event: Event, blocked: boolean, index: number }>;

  constructor(private source: Scanner, private dest: Scanner, options: ScannerOptions = {}) {
    this.id = `pipe:[${this.source.id}]>[${this.dest.id}]`;
    this.lastclosed = -1;
    this.eventQueue = new EventQueue({ id: this.id, start: options.start ?? 0 });
    this.reader = this.eventQueue.reader();
  }

  get complete(): boolean {
    return this.eventQueue.completedRead;
  }

  get lastreceived(): number {
    return this.eventQueue.maxConsumedSmallIndex;
  }

  reindex(newIndex: number): void {
    this.dest.reindex(newIndex);
  }

  private computeOutputProgress(output: Event[]): Progress {
    const returnValue: Progress = {
      closed: this.lastclosed,
      done: this.complete
    };
    if (output.length > 0) returnValue.values = output;
    return returnValue;
  }

  shift(curEvent: Event): Progress {
    this.eventQueue.push(curEvent);

    let output: Event[] = [];
    let finished: boolean;
    do {
      const iterated = this.reader.next();

      if (iterated.done) {
        this.eventQueue.removeWatermark(0);
        this.eventQueue.dequeue();
      } else {
        const event = iterated.value.event;
        const sourceResult = this.source.shift(event);

        if (sourceResult.values !== undefined && sourceResult.values.length > 0) {
          let results: Event[] = [];
          sourceResult.values.forEach((result) => {
            const destResult = this.dest.shift(result);
            if (destResult.values !== undefined) {
              results = results.concat(destResult.values);
              this.lastclosed = iterated.value.index;
            }
          });
          if (results.length > 0) output = output.concat(results);
        }
      }

      finished = iterated.done || iterated.value.blocked;
    } while (!finished);

    return this.computeOutputProgress(output);
  }

  static factory(source: ScannerFactory, dest: ScannerFactory): ScannerFactory {
    return {
      name: dest.name,
      terms: [],
      create: (options) => new Pipe(source.create(options), dest.create(options), options)
    };
  }
}
