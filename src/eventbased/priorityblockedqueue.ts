import { SortedNumericalSet } from '../vendor/generics/sortedset.js';
import { Event } from '../event.js';

/**
 * Priority-blocked event queue.
 *
 * Accepts chunked events, breaks them into atomic tokens, and hands them
 * out in priority order — the lowest watermark reads first, and only when
 * it advances can higher-watermark readers proceed. Used by ordered-choice
 * (Race) scanning: the highest-priority ambiguous choice holds the lowest
 * watermark and consumes tokens until it resolves, then readers re-sort
 * by next ambiguous index.
 */
export class PriorityBlockedQueue {

  public id: string;
  private start: number;
  private onEvict: (event: Event, index: number) => void;

  public nextBigIndex: number;
  public nextSmallIndex: number;

  public maxIndex: number;
  public maxSteps: number;

  public minIndex: number;
  public minSteps: number;

  public completedWrite: boolean;
  public completedRead: boolean;

  public readers: number;

  public accum: { [key: number]: number };

  public inQueue: { [key: number]: Event };
  public watermarks: { [key: number]: SortedNumericalSet };

  public closed: number;
  public maxConsumedSmallIndex: number;

  constructor(
    options: {
      id?: string,
      start?: number,
      onEvict?: (event: Event, index: number) => void
    } = {},
    inQueue: { [key: number]: Event } = {},
    watermarks: { [key: number]: SortedNumericalSet } = {}
  ) {
    this.id = options.id ?? 'priority-blocked-queue';
    this.start = options.start ?? 0;
    this.onEvict = options.onEvict ?? (() => {});

    this.nextBigIndex = 0;
    this.nextSmallIndex = this.start;

    this.minIndex = -1;
    this.minSteps = 0;
    this.maxIndex = -1;
    this.accum = {};

    this.completedWrite = false;
    this.completedRead = false;
    this.closed = this.start - 1;
    this.maxConsumedSmallIndex = -1;

    this.readers = 0;
    this.inQueue = inQueue;
    this.watermarks = watermarks;
    this.accum[this.nextBigIndex] = this.start;
  }

  print(): string {
    const events = Object.values(this.inQueue)
      .map(event =>
        event === null ? `DONE`.padEnd(20) : (`${event.kind}[${(event instanceof Event.Token ? event.data : event.name)}]`.padEnd(20) +
        `@ ${event.position}`)
      ).join('\n\t');
    const indices = Object.entries(this.watermarks)
      .map(([reader, indices]) =>
        `${reader}: ${Object.values(indices.items).join(', ')}`
      ).join('\n\t');
    return `EVENTS\n\t${events}\nINDICES\n\t${indices}`;
  }

  push(event: Event) {
    if (event === null) {
      this.inQueue[this.nextBigIndex] = null;
      this.maxIndex = this.nextBigIndex;
      this.completedWrite = true;
    } else {
      if (this.minIndex < 0) this.minIndex = 0;
      this.maxIndex = this.nextBigIndex;
      this.inQueue[this.maxIndex] = event;
      this.maxSteps = (event.kind === 'token') ? (event as Event.Token).data.length : 1;
      this.nextBigIndex += 1;
      this.accum[this.nextBigIndex] = this.accum[this.maxIndex] + (this.maxSteps);
      this.nextSmallIndex = this.accum[this.nextBigIndex];
    }
  }

  getLength(event: Event): number {
    if (event === undefined) return 0;
    if (event === null) return 1;
    if (event.kind === 'token') return (event as Event.Token).data.length;
    return 1;
  }

  getContent(event: Event, index: number = 0): Event {
    if (event.kind !== 'token' && index > 0) throw new Error(`Can only have one index allocated to an interval event!`);
    if (event instanceof Event.Token && event.data.length === 1) return event;
    return (event.kind === 'token') ?
      Event.token((event as Event.Token).data.charAt(index), event.position + index) :
      event;
  }

  get minSmallIndex() {
    if (this.minIndex < 0) return this.start;
    return (this.accum[this.minIndex] + this.minSteps);
  }

  peek() {
    if (this.watermarks[this.minSmallIndex] === undefined || this.watermarks[this.minSmallIndex].length < 1) {
      console.log(this);
      throw new Error(`Trying to peek on queue which is either empty or does not exist!`);
    }
    return this.watermarks[this.minSmallIndex].peek();
  }

  dequeue(max?: number): void {
    let removed = 0;
    while (
      this.watermarks[this.minSmallIndex] === undefined &&
      this.minIndex <= this.maxIndex
    ) {
      removed++;
      if (max !== undefined && removed > max) break;

      this.closed = this.minSmallIndex;
      if (
        this.inQueue[this.minIndex] === undefined ||
        this.inQueue[this.minIndex] === null ||
        this.getLength(this.inQueue[this.minIndex]) <= this.minSteps + 1
      ) {
        this.onEvict(this.inQueue[this.minIndex], this.minIndex);
        delete this.inQueue[this.minIndex];
        delete this.accum[this.minIndex];
        this.minSteps = 0;
        this.minIndex += 1;
      } else {
        this.minSteps += 1;
      }

      if (this.inQueue[this.minIndex] === null)
        this.completedRead = true;
    }
  }

  /**
   * Removes the lowest-priority watermark (the one at the head of the buffer).
   * @returns the reader number of the watermark that was removed
   */
  removeWatermark(): number {
    if (this.watermarks[this.minSmallIndex] === undefined) {
      console.log(this);
      throw new Error(`Trying to remove watermark when no watermarks exist!`);
    }
    const removed = this.watermarks[this.minSmallIndex].pop();
    if (this.watermarks[this.minSmallIndex].length === 0)
      delete this.watermarks[this.minSmallIndex];

    return removed;
  }

  /**
   * Reindex the bottom watermark to a new small index.
   */
  reindexWatermark(newSmallIndex: number) {
    if (newSmallIndex <= this.minSmallIndex) return;
    if (this.watermarks[this.minSmallIndex] === undefined) {
      console.log(this);
      throw new Error(`No watermarks in queue!`);
    }
    const removed = this.removeWatermark();
    if (this.watermarks[newSmallIndex] === undefined)
      this.watermarks[newSmallIndex] = new SortedNumericalSet();
    this.watermarks[newSmallIndex].push(removed);
    this.dequeue();
    if (this.maxIndex < this.minIndex) {
      this.nextBigIndex = this.minIndex;
      this.accum[this.nextBigIndex] = newSmallIndex;
    }
  }

  addWatermark(smallIndex?: number) {
    if (smallIndex === undefined)
      smallIndex = this.accum[this.minIndex] + this.minSteps;

    const readerNum = this.readers++;
    if (this.watermarks[smallIndex] === undefined)
      this.watermarks[smallIndex] = new SortedNumericalSet();
    this.watermarks[smallIndex].push(readerNum);
    return readerNum;
  }

  reader(): Generator<{ event: Event, blocked: boolean }, { finished: boolean }> {

    let bigIndex = this.minIndex < 0 ? 0 : this.minIndex;
    let stepsAtIndex = this.minSteps;
    let smallIndex = this.accum[bigIndex] + stepsAtIndex;
    this.addWatermark(smallIndex);

    const generate = function * (this: PriorityBlockedQueue) {
      while (this.inQueue[bigIndex] !== null) {
        if (this.minIndex > bigIndex) {
          bigIndex = this.minIndex;
          smallIndex = this.minSmallIndex;
          stepsAtIndex = this.minSteps;
        }
        if (this.inQueue[bigIndex] === null) break;

        if (this.inQueue[bigIndex] === undefined) {
          console.log(this);
          throw new Error(`Trying to pull @ ${bigIndex} from empty event queue!`);
        }
        const indexLength = this.getLength(this.inQueue[bigIndex]);
        if (this.maxConsumedSmallIndex < smallIndex) this.maxConsumedSmallIndex = smallIndex;

        const [ nextBigIndex, nextStepsAtIndex ] = stepsAtIndex + 1 >= indexLength ?
          [ bigIndex + 1, 0 ] :
          [ bigIndex, stepsAtIndex + 1 ];
        const nextSmallIndex = this.accum[nextBigIndex] + nextStepsAtIndex;
        const blocked = (this.inQueue[nextBigIndex] === undefined);
        yield { event: this.getContent(this.inQueue[bigIndex], stepsAtIndex), blocked };

        bigIndex = nextBigIndex;
        smallIndex = nextSmallIndex;
        stepsAtIndex = nextStepsAtIndex;
      }

      if (this.inQueue[bigIndex] === null) {
        this.completedRead = true;
        return { finished: true };
      }
      return { finished: false };
    }.bind(this);

    return generate();
  }
}
