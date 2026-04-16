
import { Queue } from '../vendor/generics/queue.js';
import { Signal } from '../signal.js';
import { Repository } from './../scanner.js';
import { Range } from './../range.js'
import { Event } from './../event.js'
import { Scanner, ScannerFactory, AbstractScannerFactory } from './../scanner.js'
import { Position } from './../position.js'
import { DataToken } from './../datatoken.js'

export class Not implements Scanner<string, Range.ReadOutput[]> {

  public id: string
  public toExclude: Set<string>
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
    toExclude: string[],
    id?: string) {

    this.id = id === undefined ? toExclude.join('||') : id;
    this.toExclude = new Set<string>();
    for (let char of toExclude) this.toExclude.add(char);
    this.inputs = toExclude;
    this.holding = new Queue<{ data: string, index: number }>();
    this.matched = false;
    this.closedIndex = -1;
    this.completed = false;
    this.terminal = null;
    this.toEmit = [];
    this.lastObserved = -1;
    this.closedIndex = -1;
    this.lastMatched = false;
    this.configurations = { withhold: false, quickClose: false }
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
    return Event.start(`not:${this.id}`, Position.absolute(index), {
      source: `not:${this.id}`, 
      operation: `not`, 
      arguments: Array.from(this.toExclude)
    });
  }

  endEvent(index) {
    return Event.end(`not:${this.id}`, Position.absolute(index) );
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

      if (signal.value.index <= this.lastObserved) throw new Error(`Same input received twice!`);

      let isInEvent = !this.toExclude.has(signal.value.data);
      if (isInEvent) {
        if (!this.configurations.quickClose) {
          if (!this.matched) this.toEmit.push(this.startEvent(signal.value.index));
          this.closedIndex = this.lastObserved;
          this.toEmit.push(Signal.toDataToken(signal));
          this.matched = true;
        } else {
          this.toEmit.push(this.startEvent(signal.value.index));
          this.toEmit.push(this.endEvent(signal.value.index));
          this.closedIndex = signal.value.index;
        }
      } else {
        if (this.matched) this.toEmit.push(this.endEvent(this.lastObserved));
        this.closedIndex = signal.value.index;
        this.matched = false;
      }
    }

    this.lastObserved = signal.value.index;

    return this.getReturnValue();
  }

  print(tabs: number = 0) {
    const times = (num: number, str: string) => {
      let result = '';
      for (let i = 0; i < num; i++) result += str;
      return result;
    }
    let output = `${times(tabs, '\t')}Not:${this.id}\n`;
    return output;
  }

  public static factory(
    toExcludeInput: string[] | string,
    id?: string): ScannerFactory<string, Range.ReadOutput[]> {

    let toExclude: string[];
    if (typeof toExcludeInput === 'string') {
      toExclude = [toExcludeInput];
    } else {
      toExclude = toExcludeInput;
    }
    id = id === undefined ? toExclude.join('||'): id;

    let producer = (repository: Repository) => {  
      let not = new Not(toExclude, id as string); 
      return not;
    }; 

    return new AbstractScannerFactory<string, Range.ReadOutput[]>(id, 'not', producer) as ScannerFactory<string, Range.ReadOutput[]>;
  }
}

