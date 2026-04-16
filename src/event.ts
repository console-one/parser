import { UUID } from "./vendor/generics/uuid.js";
import { DataToken } from "./datatoken.js";
import { Position } from "./position.js";

type EventKind = 'start' | 'end' | 'token'

export abstract class Event {
  kind: EventKind
  uuid?: string
  metadata?: any
  readonly name: string
  readonly position: number


  constructor(kind: EventKind, name: string, position: Position) {
    this.kind = kind;
    this.name = name;
    this.position = position.get();
  }

  static start = (name: string, position: Position | number, metadata?: any) => {
    return new Event.Start(name, position instanceof Position ? position : Position.absolute(position), metadata);
  }

  static end = (name: string, position: Position | number) => {
    return new Event.End(name, position instanceof Position ? position : Position.absolute(position));
  }

  static token = (data: string, position: Position | number) => {
    if (position instanceof Position) return new Event.Token(position, data);
    return new Event.Token(position, data);
  }

  static trackedStart = (name: string, position: Position | number, metadata?: any) => {
    let rangeID = UUID.random(); 
    return new Event.TrackedStart(name, position instanceof Position ? position : Position.absolute(position), rangeID, metadata);
  }

  static trackedEndOf = (start: Event.TrackedStart, position: Position) => {
    return new Event.TrackedEnd(start.name, position instanceof Position ? position : Position.absolute(position), start.rangeID);
  }

  static describes = (item: any) => {
    return (typeof item === 'object') && 
    ((item.kind === 'start') || (item.kind === 'end') || (item.kind === 'token')) && 
    (((item.name !== undefined) && typeof item.name === 'string') || (item.data !== undefined && typeof item.data === 'string'))&&
    ((item.position !== undefined) && typeof item.position === 'number')
  }

  static isStart = (event: any) =>  ((event instanceof Event ) && (event as Event).kind === 'start');

  static isTStart = (event: any) => (Event.isStart(event) ? event.rangeID !== undefined : false);

  static isEnd = (event: any) => ((event instanceof Event ) && (event as Event).kind === 'end');

  static isTEnd = (event: any) => (Event.isEnd(event) ? event.rangeID !== undefined : false);

  static isToken = (event: any) => ((event instanceof Event ) && (event as Event).kind === 'token');

  static isTokenLike = (event: any) => Event.isToken(event) ? true : event instanceof DataToken;

  static asToken = (event: DataToken | Event.Token): Event.Token => (event instanceof Event.Token) ? event :  Event.token(event.text, event.start.get());

  static squish = (prev: any, next: any): Event[] => {

    if (Event.isTokenLike(prev)) {
      
      let tok: Event.Token = Event.asToken(prev);
      if (typeof next === 'string') return [Event.token(tok.data + next, tok.position)];
      else if (Event.isTokenLike(next)) {
        let tok20: Event.Token = Event.asToken(next);
        if (tok20.position === tok.position + tok.data.length) return [Event.token(tok.data + tok20.data, tok.position)]
        return [tok20];
      } else return [tok, next];
    } else {


      if (Event.isStart(prev) || Event.isEnd(prev)) {
        if (typeof next === 'string') return [prev, Event.token(next, Event.isStart(prev) ? (prev as Event).position : (prev as Event).position + 1 )]
        if (next instanceof DataToken) next = Event.asToken(next)
        return [prev, next];
      }

    }

    return [prev, next];
  }

  static toScannable = (mixedForm: (string | Event | DataToken)[] ): Event[] => {
    let reducing: any[] = [mixedForm[0]];
    let result: any[] = [];
    for (let i = 1; i < mixedForm.length;  i++) {
      reducing = Event.squish(reducing[reducing.length-1], mixedForm[i]);
      if (reducing.length > 1) {
        const addingToResult = reducing.slice(0, 1)[0];
        if (!(typeof addingToResult === 'string' && addingToResult.length < 1))  result.push(addingToResult);
      }
    }
    result = result.concat(reducing);
    return result;
  }

}

export namespace Event {
  
  export class Start extends Event {
    readonly metadata: any

    constructor(name: string, position: Position, metadata: any = {}) {
      super('start', name, position);
      this.metadata = metadata;
    }
  }

  export class TrackedStart extends Event {
    readonly metadata: any
    readonly rangeID: string
    constructor(name: string, position: Position, instanceID: string, metadata: any = {}) {
      super('start', name, position);
      this.metadata = metadata;
      this.rangeID = instanceID;
    }
  }
  
  export class End extends Event {
    constructor(name: string, position: Position) {
      super('end', name, position);
    }
  }

  export class TrackedEnd extends Event {
    readonly rangeID: string
    constructor(name: string, position: Position, instanceID: string) {
      super('end', name, position);
      this.rangeID = instanceID;
    }
  }

  export class Token extends Event {
    readonly data: string
    constructor(position: Position | number, data: string) {
      super('token', 'token', position instanceof Position ? position : Position.absolute(position));
      this.data = data;
    }

    get token(): DataToken {
      return new DataToken(Position.absolute(this.position), this.data);
    }
  }
}

