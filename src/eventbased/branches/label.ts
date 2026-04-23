import { Scanner, Progress, ScannerFactory } from '../scanner.js';
import { PriorityBlockedQueue } from '../priorityblockedqueue.js';
import { Event } from '../../event.js';

/**
 * Branch scanner that emits a synthetic Start event tagged with
 * `{ [key]: value }` metadata. Used to retroactively attach metadata to
 * an emitted interval — Search reads the branch's Start metadata and
 * merges it into the original state's Start event.
 */
export class Label implements Scanner {

  public id: string;
  private eventQueue: PriorityBlockedQueue;

  constructor(private key: string, private value: any) {
    this.id = key;
    this.eventQueue = new PriorityBlockedQueue();
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

  reindex(newIndex: number): void {
    this.eventQueue.reindexWatermark(newIndex);
  }

  shift(event: Event): Progress {
    const metadata: Record<string, any> = {};
    metadata[this.key] = this.value;

    return {
      closed: 0,
      done: false,
      values: [ Event.start(`label:${this.id}`, event.position, metadata) ]
    };
  }

  static factory(key: string, value: any): ScannerFactory {
    return {
      name: `label:${key}`,
      terms: [],
      create: () => new Label(key, value)
    };
  }
}
