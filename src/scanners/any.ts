
import { Queue } from '../vendor/generics/queue.js';
import { Signal } from '../signal.js';
import { Repository } from './../scanner.js';
import { Range } from './../range.js'
import { Event } from './../event.js'
import { Scanner, ScannerFactory, AbstractScannerFactory } from './../scanner.js'
import { Position } from './../position.js'


export class Any implements Scanner<string, Range.ReadOutput[]> {

  public id: string
  public toInclude: Set<string>
  public holding: Queue<{ data: string, index: number }>
  public closedIndex: number
  public lastObserved: number
  public completed: boolean
  public matched: boolean
  public terminal: Signal<Range.ReadOutput[], number>
  public state: any
  public toEmit: Range.ReadOutput[]
  public withhold: boolean
  public configurations: any
  public lastMatched: boolean
  public inputs: string[]

  constructor(
    toInclude: string[],
    id?: string) {

    this.id = id === undefined ? toInclude.join('||') : id;
    this.toInclude = new Set<string>();
    for (let char of toInclude) this.toInclude.add(char);
    this.inputs = toInclude;
    this.holding = new Queue<{ data: string, index: number }>();
    this.matched = false;
    this.closedIndex = -1;
    this.completed = false;
    this.terminal = null;
    this.toEmit = [];
    this.lastObserved = -1;
    this.closedIndex = -1;
    this.lastMatched = false;
    this.configurations = { withhold: false }
  }

  complete() {
    return this.completed;
  }

  getReturnValue() {
    let result: any = {
      done: this.completed,
      value: {
        index: this.closedIndex
      }
    }
    if (this.toEmit.length > 0 && (!this.configurations.withhold || !this.matched)) {
      result.value.data = this.toEmit;
      this.toEmit = [];
    }
    // See Match: caching the result object (not a JSON clone) preserves class
    // instances (DataToken, Event) in value.data so downstream instanceof checks work.
    if (this.completed) this.terminal = result;
    return result;
  }


  startEvent(index) {
    return Event.start(`any:${this.id}`, Position.absolute(index), {
      source: `any:${this.id}`, 
      operation: `any`, 
      arguments: Array.from(this.toInclude)
    });
  }

  endEvent(index) {
    return Event.end(`any:${this.id}`, Position.absolute(index) );
  }

  shift(signal: Signal<string, number>): Signal<Range.ReadOutput[], number> {
    if (this.completed) return this.terminal; 
    if (signal.done) this.completed = true;

    if ((signal.value === undefined) || signal.done) {
      this.completed = true;
      this.closedIndex = ((signal.value !== undefined) && (signal.value.index !== undefined)) ? signal.value.index : this.lastObserved;
      if (this.matched) this.toEmit.push(this.endEvent(this.closedIndex));
      return this.getReturnValue();

    } else if (signal.value !== undefined && signal.value.data !== undefined) {
      let isInEvent = this.toInclude.has(signal.value.data);
      if (isInEvent) {
        if (!this.matched) this.toEmit.push(this.startEvent(signal.value.index));
        this.closedIndex = this.lastObserved;
        this.toEmit.push(Signal.toDataToken(signal));
        this.matched = true;
      } else {
        if (this.matched) this.toEmit.push(this.endEvent(this.lastObserved));
        this.closedIndex = signal.value.index;
        this.matched = false;
      }
    }

    this.lastObserved = signal.value.index;

    return this.getReturnValue();
  }

  // todo: move to utils
  print(tabs: number = 0) {
    const times = (num: number, str: string) => {
      let result = '';
      for (let i = 0; i < num; i++) result += str;
      return result;
    }
    let output = `${times(tabs, '\t')}Any:${this.id}\n`;
    return output;
  }

  public static factory(
    toIncludeInput: string[] | string,
    id?: string): ScannerFactory<string, Range.ReadOutput[]> {

    let toInclude: string[];
    if (typeof toIncludeInput === 'string') {
      toInclude = [toIncludeInput];
    } else {
      toInclude = toIncludeInput;
    }
    id = id === undefined ? toInclude.join('||'): id;

    let producer = (repository: Repository) => {  
      let any = new Any(toInclude, id as string); 
      return any;
    }; 

    return new AbstractScannerFactory<string, Range.ReadOutput[]>(id, 'any', producer) as ScannerFactory<string, Range.ReadOutput[]>;
  }
}

