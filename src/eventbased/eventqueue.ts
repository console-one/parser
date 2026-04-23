import { Event } from '../event.js';

/**
 * Event queue with watermarks.
 *
 * Accepts chunked events and breaks them into atomic tokens which are
 * then processed by operators prioritized by watermarks. Token events
 * whose data is longer than one character are sub-indexed so that every
 * small-index step corresponds to a single character of input.
 *
 * `smallIndex` advances per atomic step; `bigIndex` advances per pushed
 * event. Watermarks are registered against a small-index position and
 * prevent dequeue from advancing past that position.
 */
export class EventQueue {

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
  public watermarks: { [key: number]: Set<number> };
  public positions: { [key: number]: number };

  public closed: number;
  public maxConsumedSmallIndex: number;

  constructor(
    options: {
      id?: string,
      start?: number,
      onEvict?: (event: Event, index: number) => void
    } = {},
    inQueue: { [key: number]: Event } = {},
    watermarks: { [key: number]: Set<number> } = {}
  ) {
    this.id = options.id ?? 'event-queue';
    this.start = options.start ?? 0;
    this.onEvict = options.onEvict ?? (() => {});

    this.nextBigIndex = 0;
    this.nextSmallIndex = this.start;

    this.minIndex = -1;
    this.minSteps = 0;
    this.maxIndex = -1;
    this.accum = {};
    this.positions = {};

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
        `${reader}: ${Array.from(indices.values()).join(', ')}`
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
    return (event.kind === 'token') ?
      Event.token((event as Event.Token).data.charAt(index), event.position + index) :
      event;
  }

  get minSmallIndex() {
    if (this.minIndex < 0) return this.start;
    return (this.accum[this.minIndex] + this.minSteps);
  }

  get maxSmallIndex() {
    return this.accum[this.maxIndex];
  }

  /**
   * Drop events from the head of the buffer while no watermark holds them.
   */
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

  removeWatermark(watermark: number): void {
    const position = this.positions[watermark];
    if (position === undefined) {
      console.log(this);
      throw new Error(`Watermark ${watermark} doesn't exist!`);
    }
    this.watermarks[position].delete(watermark);
    if (this.watermarks[position].size === 0)
      delete this.watermarks[position];
    delete this.positions[watermark];
  }

  reindexWatermark(watermark: number, newSmallIndex: number) {
    this.removeWatermark(watermark);
    if (this.watermarks[newSmallIndex] === undefined)
      this.watermarks[newSmallIndex] = new Set();
    this.watermarks[newSmallIndex].add(watermark);
    this.positions[watermark] = newSmallIndex;
  }

  addWatermark(smallIndex?: number) {
    if (smallIndex === undefined)
      smallIndex = this.accum[this.minIndex < 0 ? 0 : this.minIndex] + this.minSteps;

    const readerNum = this.readers++;
    if (this.watermarks[smallIndex] === undefined)
      this.watermarks[smallIndex] = new Set();
    this.watermarks[smallIndex].add(readerNum);
    this.positions[readerNum] = smallIndex ?? -1;
    return readerNum;
  }

  reader(watermark?: number, end?: number): Generator<{ event: Event, index: number, blocked: boolean }> {

    let bigIndex = this.minIndex < 0 ? 0 : this.minIndex;
    let stepsAtIndex = this.minSteps;
    let smallIndex: number;
    if (watermark === undefined) {
      smallIndex = this.accum[bigIndex] + stepsAtIndex;
      this.addWatermark(smallIndex);
    } else {
      smallIndex = this.positions[watermark];
      while (this.accum[bigIndex] + stepsAtIndex < smallIndex) {
        if (
          this.inQueue[bigIndex] === undefined ||
          this.inQueue[bigIndex] === null ||
          this.getLength(this.inQueue[bigIndex]) <= stepsAtIndex + 1
        ) {
          stepsAtIndex = 0;
          bigIndex += 1;
        } else {
          stepsAtIndex += 1;
        }
      }
    }

    const generate = function * (this: EventQueue) {
      while (this.inQueue[bigIndex] !== null) {
        if (end !== undefined && smallIndex > end) return { finished: false };
        if (this.inQueue[bigIndex] === undefined) {
          console.log(this);
          throw new Error(`Trying to pull @ ${bigIndex} from empty event queue!`);
        }

        let indexLength = this.getLength(this.inQueue[bigIndex]);
        if (this.maxConsumedSmallIndex < smallIndex) this.maxConsumedSmallIndex = smallIndex;

        let [ nextBigIndex, nextStepsAtIndex ] = stepsAtIndex + 1 >= indexLength ?
          [ bigIndex + 1, 0 ] :
          [ bigIndex, stepsAtIndex + 1 ];
        let nextSmallIndex = this.accum[nextBigIndex] + nextStepsAtIndex;

        yield {
          event: this.getContent(this.inQueue[bigIndex], stepsAtIndex),
          index: smallIndex,
          blocked: this.inQueue[nextBigIndex] === undefined
        };

        bigIndex = nextBigIndex;
        smallIndex = nextSmallIndex;
        stepsAtIndex = nextStepsAtIndex;
      }

      this.completedRead = true;
      return { finished: true };
    }.bind(this);

    return generate();
  }
}
