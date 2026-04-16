import { UUID } from './vendor/generics/uuid.js'
import { Event } from './event.js'
import { Position } from './position.js'
import { DataToken } from './datatoken.js'
import { Link } from './vendor/generics/link.js'

type Metadata = any

export namespace Range {
  export type PathInfo = {
    index: number,
    name: string,
  }

  export type Summary = {
    instanceId: UUID,
    name: string,
    path: PathInfo[],
    start: number,
    end: number,
    content: string,
    metadata: Metadata,
  }

  export type Token = string
  export type ReadOutput = Event | DataToken
}

export abstract class Range {

  private _instanceId: UUID
  // Human readable identifier for the range
  private _name: string
  private _start: Position
  private _metadata?: any

  private _parent?: Range

  private _leftSibling?: Range
  private _rightSibling?: Range

  // Exclusive End
  abstract end: Position
  abstract length: number
  abstract text: string

  public link: Link

  constructor(
    name: string,
    start?: Position,
    metadata?: any,
    instanceId?: UUID,
    parent?: Range,
    leftSibling?: Range,
    rightSibling?: Range,
  ) {
    this._instanceId = instanceId || UUID.random();
    this._name = name;
    this._start = start;
    this._metadata = metadata || { type: 'interval' }
    this._parent = parent;
    this._leftSibling = leftSibling;
    this._rightSibling = rightSibling;
  }

  abstract type(): string

  // Returns an array of Events and contents of a range.
  abstract read(): Array<Event>;

  // Swap the outgoing child with the incoming child.
  abstract swapChild(outgoing: Range, incoming: Range): void;


  get instanceId(): UUID {
    return this._instanceId;
  }

  get name(): string {
    return this._name;
  }
  // Inclusive Start
  get start(): Position {
    return this._start;
  }

  set start(start: Position) {
    this._start = start;
    this.end = Position.relative(this.length, start);
  }

  get metadata(): any {
    return this._metadata;
  }

  get parent(): Range | undefined {
    return this._parent;
  }
  set parent(parent: Range | undefined) {
    this._parent = parent;
  }

  get leftSibling(): Range | undefined {
    return this._leftSibling;
  }
  protected set leftSibling(leftSibling: Range | undefined) {
    this._leftSibling = leftSibling;
  }

  get rightSibling(): Range | undefined {
    return this._rightSibling;
  }
  protected set rightSibling(rightSibling: Range | undefined) {
    this._rightSibling = rightSibling;
  }

  get index(): number {
    if (this.leftSibling) {
      return this.leftSibling.index + 1;
    }
    return 0;
  }

  /**
   * Returns the path of the root up to this range.
   */
  get path(): Range.PathInfo[] {
    const pathInfo = {
      index: this.index,
      name: this.name,
    }

    if (this.parent) {
      return this.parent.path.concat(pathInfo);
    } else {
      return [pathInfo];
    }
  }

  get breif(): string {
    return `${this.name}:${this.text}`
  }

  /**
   * Returns a summary of this interval for debugging purposes.
   */
  get summary(): Range.Summary {
    return {
      instanceId: this._instanceId,
      name: this.name,
      path: this.path,
      start: this.start.get(),
      end: this.end.get(),
      content: this.text,
      metadata: this.metadata,
    }
  }

  get startEvent(): Event.Start {
    return new Event.Start(this.name, this.start, this.metadata);
  }
  get endEvent(): Event.End {
    return new Event.End(this.name, this.end);
  }

  // Update end using start and content, then propagate to right sibling
  protected updateEnd(notifyParent: boolean = true): void {
    // Update end of current range
    this.end = Position.relative(this.length, this.start);
    // Update end of all right siblings
    if (this.rightSibling) {
      this.rightSibling.start = this.end;
      this.rightSibling.updateEnd(false);
    }
    if (notifyParent) {
      this.parent?.updateEnd();
    }
  }

  // Add sibling to the right
  append(newSibling: Range) {
    const parent = this.parent;
    if (parent !== undefined) {
      // Setup parent relationship
      newSibling.parent = parent;

      // Setup sibling relationship
      const currentRight = this.rightSibling;
      newSibling.rightSibling = currentRight;
      if (currentRight !== undefined) {
        currentRight.leftSibling = newSibling;
      }
      this.rightSibling = newSibling;
      newSibling.leftSibling = this;
    }
    this.updateEnd();
  }

  /**
   * Swap out the range with another one.
   * Updates relationship with Parent and Siblings.
   *
   * Note: Children are not updated, the whole range "Node" is swapped out.
   */
  swap(other: Range): void {
    other.parent = this.parent;
    this.parent?.swapChild(this, other);
    other.start = this.start;

    other.leftSibling = this.leftSibling;
    if (this.leftSibling) {
      this.leftSibling.rightSibling = other;
    }
    other.rightSibling = this.rightSibling;
    if (this.rightSibling) {
      this.rightSibling.leftSibling = other;
    }
    other.updateEnd();
  }


  equals(other: Range): boolean {
    let listA = this.read();
    let listB = other.read();
    while (listA.length > 0 && listB.length > 0) {
      let itemA = listA.shift();
      let itemB = listB.shift();
      if (itemA instanceof Event && itemB instanceof Event) {
        let eventA = itemA as Event;
        let eventB = itemB as Event;
        if (eventA.kind !== eventB.kind) return false;
        if (eventA.name !== eventB.name) return false;
        if (eventA.position !== eventB.position) return false;
        if (eventA.kind === 'start') {
          let startA = eventA as Event.Start;
          let startB = eventB as Event.Start;
          let metadataA = JSON.stringify(startA.metadata);
          let metadataB = JSON.stringify(startB.metadata);
          if (JSON.stringify(startA.metadata) !== JSON.stringify(startB.metadata)) return false;
        }
      } else if (Event.Token.describes(itemA) && Event.Token.describes(itemB)) {
        let tokenA = (itemA as Event.Token).token;
        let tokenB = (itemB as Event.Token).token;
        if (tokenA.text !== tokenB.text) return false;
        if (tokenA.start.get() !== tokenB.start.get()) return false;
      } else {
        return false;
      }
    }
    if (listA.length > 0 || listB.length > 0) return false;
    return true;
  }
}
