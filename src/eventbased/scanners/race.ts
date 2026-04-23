import { Scanner, Progress, ScannerOptions } from '../scanner.js';
import { PriorityBlockedQueue } from '../priorityblockedqueue.js';
import { Event } from '../../event.js';

export class Race implements Scanner {

  /** Events currently being processed by this scanner. */
  eventQueue: PriorityBlockedQueue;

  /** Child scanners and their associated readers. */
  children: {
    [key: number]: {
      blocked: boolean;
      reader: Generator<{ event: Event, blocked: boolean }>;
      scanner: Scanner;
    };
  };

  /** Most recent state emitted by a child scanner. */
  currentState: string;

  id: string;

  constructor(public scanners: Scanner[] = [], options: ScannerOptions = {}) {
    this.id = `race:${scanners.map(scanner => scanner.id).join(',')}`;
    this.eventQueue = new PriorityBlockedQueue({ id: this.id, start: options.start });

    this.children = {};
    for (let index = 0; index < scanners.length; index++) {
      this.children[index] = {
        blocked: false,
        reader: this.eventQueue.reader(),
        scanner: scanners[index]
      };
    }
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

  private validateInput(event: Event) {
    if (this.eventQueue.completedWrite) {
      console.error(`Attempted to feed event `, event, ` into race scanner: `, this);
      console.error(`But race scanner has already received a closing signal. Event queue: `, this.eventQueue);
      throw new Error(`Multiple close events submitted to the same input scanner!`);
    }
  }

  private scannerIndices(): number[] {
    return Object.keys(this.children).map(Number);
  }

  private resetAt(newIndex: number, blocked: boolean) {
    for (const child of this.scannerIndices()) {
      this.eventQueue.reindexWatermark(newIndex);
      this.children[child].scanner.reindex(newIndex);
      if (blocked) this.children[child].blocked = true;
    }
  }

  reindex(newIndex: number): void {
    this.resetAt(newIndex, false);
  }

  shift(event: Event): Progress {
    this.validateInput(event);
    this.eventQueue.push(event);

    if (this.scanners.length === 0) return this.computeOutputProgress([]);

    let output: Event[] = [];
    for (const scannerIndex of this.scannerIndices()) this.children[scannerIndex].blocked = false;

    do {
      const indexNumber = this.eventQueue.peek();
      const generator = this.children[indexNumber].reader;
      let iterated: IteratorResult<{ event: Event, blocked: boolean }>;
      try {
        iterated = generator.next();
      } catch (error) {
        console.log('Race.shift() FAILED FOR READER', indexNumber);
        console.log('RACE QUEUE:', this.eventQueue);
        console.log(this.eventQueue.print());
        throw error;
      }

      const curEvent = iterated.done ? null : iterated.value.event;
      const result = this.children[indexNumber].scanner.shift(curEvent);
      this.eventQueue.reindexWatermark(result.closed + 1);

      if (result.values !== undefined && result.values.length > 0) {
        output = output.concat(result.values);
        if (this.currentState === undefined) this.currentState = result.values[0].name;
        for (const value of result.values) {
          if (value instanceof Event.End && value.name === this.currentState) {
            this.resetAt(result.closed + 1, iterated.done || iterated.value.blocked);
            this.currentState = undefined;
            break;
          }
        }
      }
      this.children[indexNumber].blocked = iterated.done || iterated.value.blocked;

    } while (!this.children[this.eventQueue.peek()].blocked);

    return this.computeOutputProgress(output);
  }
}
