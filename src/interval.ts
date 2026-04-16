import { UUID } from './vendor/generics/uuid.js'
import { DataToken } from './datatoken.js'
import { Event } from './event.js'
import { Position } from './position.js'
import { Range } from './range.js'


export class Interval extends Range {
  private _end: Position
  private _firstChild?: Range
  private _lastChild?: Range

  constructor(
    start: Position,
    name: string,
    metadata?: any,
    instanceId?: UUID,
    parent?: Range,
    leftSibling?: Range,
    rightSibling?: Range,
    end?: Position,
    firstChild?: Range,
    lastChild?: Range,
  ) {
    super(name, start, metadata, instanceId, parent, leftSibling, rightSibling);
    this._end = end || Position.relative(this.length, start);
    this._firstChild = firstChild;
    this._lastChild = lastChild;
  }

  /**
   * Exclusive end position
   */
  get end(): Position {
    return this._end;
  }

  protected set end(end: Position) {
    this._end = end;
  }

  get firstChild(): Range | undefined {
    return this._firstChild;
  }
  private set firstChild(firstChild: Range | undefined) {
    this._firstChild = firstChild;
  }

  get lastChild(): Range | undefined {
    return this._lastChild;
  }
  private set lastChild(lastChild: Range | undefined) {
    this._lastChild = lastChild;
  }

  /**
   * Renders the content of this interval as text.
   */
  get text(): string {
    const parts: string[] = []
    for (const child of this.children()) {
      parts.push(child.text)
    }
    return parts.join('')
  }

  get length(): number {
    let size: number = 0;
    for (const child of this.children()) {
      size += child.length;
    }
    return size;
  }

  * children(): Generator<Range, undefined, Range | undefined> {
    let currentChild = this.firstChild;
    while (currentChild != undefined) {
      yield currentChild;
      currentChild = currentChild.rightSibling;
    }
    return undefined;
  }

  override read(): Array<Event> {
    const output = new Array<Event>();
    output.push(new Event.TrackedStart(this.name, this.start, this.instanceId, this.metadata));
    for (const child of this.children()) {
      for (const childOutput of child.read()) {
        output.push(childOutput);
      }
    }
    let endEvent = this.instanceId;
    output.push(new Event.TrackedEnd(this.name, this.end, this.instanceId));
    return output;
  }

  type() { return 'interval'; }

  // Add a child as last child
  appendChild(child: Range): void {
    child.parent = this;
    if (this.firstChild == undefined) {
      this.firstChild = child;
    }
    this.lastChild?.append(child);
    this.lastChild = child;
    this.updateEnd();
  }

  // When swaping a range, ensure children references are updated as the parent
  swapChild(outgoing: Range, incoming: Range): void {
    if (this.firstChild && this.firstChild === outgoing) {
      this.firstChild = incoming;
    }
    if (this.lastChild && this.lastChild === outgoing) {
      this.lastChild = incoming;
    }
  }

  equals(other: any): boolean {
    return this === other || (
      other &&
      other instanceof Interval &&
      this.name === other.name &&
      this.start.get() === other.start.get() &&
      // TODO: Clearly define how metadata should be used here
      //(this.metadata === undefined || this.metadata === other.metadata) &&
      this.childrenEquals(other)
    );
  }

  private childrenEquals(other: Interval): boolean {
    let children = this.children();
    let otherChildren = other.children();

    for (const child of children) {
      const otherChild = otherChildren.next().value;
      // If other has no more children or they don't equal
      if (!otherChild || !child.equals(otherChild)) {
        return false;
      }
    }

    // If other still has more children, then they are not equal
    if (otherChildren.next().value) {
      return false;
    }

    return true;
  }

  static builder(start: Event.Start): Interval.Builder {
    return new Interval.Builder(start);
  }
}

export namespace Interval {

  export class Builder {
    private rootInterval: Interval
    private currentInterval: Interval
    done: boolean

    constructor(start: Event.Start) {
      this.rootInterval = new Interval(Position.absolute(start.position), start.name, start.metadata)
      this.currentInterval = this.rootInterval;
      this.done = false;
    }

    build(): Interval | Error {
      if (!this.done) {
        return new Error(`Cannot build an interval with open start events.`);
      }
      return this.rootInterval;
    }

    consume(event: Event | DataToken): Interval.Builder {
      if (this.done) {
        throw new Error(`Cannot consume event: "${event.name}" as the builder is done.`);
      } else if (event instanceof Event.Start) {
        this.consumeStart(event);
      } else if (event instanceof Event.End) {
        this.consumeEnd(event);
      } else if (event instanceof Event.Token) {
        this.consumeToken(event);
      } else if (event instanceof DataToken) {

      }
      return this;
    }

    private consumeStart(start: Event.Start): void {
      const nextInterval = new Interval(
        Position.absolute(start.position),
        start.name,
        start.metadata,
      );
      this.currentInterval.appendChild(nextInterval);
      this.currentInterval = nextInterval;
    }

    private consumeEnd(end: Event.End): void {
      if (end.name !== this.currentInterval.name) {
        throw new Error(
          `Invalid end event: "${end.name}". Current: "${this.currentInterval.name}"`
        );
      } else if (!this.currentInterval.parent) {
        this.done = true;
      } else if (this.currentInterval.parent instanceof Interval) {
        this.currentInterval = this.currentInterval.parent;
      }
    }

    private consumeToken(token: Event.Token): void {
      if (this.currentInterval.lastChild instanceof DataToken) {
        const newChild = new DataToken(
          this.currentInterval.lastChild.start,
          this.currentInterval.lastChild.text + token.data,
          {},
          UUID.random(),
          this.currentInterval
        );
        this.currentInterval.swapChild(this.currentInterval.lastChild, newChild);
      } else {
        // TODO: fix whitespace tokens so we don't need the line below
        if (/\s/.test(token.data)) return;
        this.currentInterval.appendChild(DataToken.from(token.position, token.data));
      }
    }
  }
}
