import { UUID } from './vendor/generics/uuid.js'
import { Event } from './event.js'
import { Position } from './position.js'
import { Range } from './range.js'
import { Signal } from './signal.js'


export class DataToken extends Range {
  private _end: Position
  private readonly _text: string

  constructor(
    start: Position,
    text: string,
    metadata?: any,
    instanceId? : UUID,
    parent?: Range,
    leftSibling?: Range,
    rightSibling?: Range,
    end?: Position,
  ) {
    super('DataToken', start, metadata, instanceId, parent, leftSibling, rightSibling);
    this._end = end || Position.relative(text.length, start);
    this._text = text;
  }

  type() { return 'token'; }

  get end(): Position {
    return this._end;
  }
  protected set end(end: Position) {
    this._end = end;
  }

  get text(): string {
    return this._text;
  }

  get length() {
    return this.text.length;
  }

  read(): Event[] {
    return [
      new Event.Token(this.start, this.text)
    ];
  }

  swapChild(outgoing: Range, incoming: Range): void {
    throw new Error('DataToken cannot have children. swapChild() is not supported.');
  }

  equals(other: any): boolean {
    return this === other || (
      other &&
      other instanceof DataToken &&
      this.name === other.name &&
      this.start.get() === other.start.get() &&
      this.text === other.text
    );
  }

  static from = (index: number, data: string) => {
    return new DataToken(Position.absolute(index), data);
  }

  static describes = (data: any) => {
    if (data === undefined) return false;
    return data.start !== undefined && data.text !== undefined && data.parent !== undefined
  }

  static fromSignal = (data: Signal<string, number>) => {
    if (data.value.data !== undefined) {
      return DataToken.from(data.value.index, data.value.data ); 
    }
    throw new Error(`Cannot create token from signal!`) ; 
  }
}
