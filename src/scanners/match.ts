
import { Heap } from 'heap-js';
import { Queue } from '../vendor/generics/queue.js';
import { DataToken } from '../datatoken.js';
import { Event } from '../event.js';
import { Position } from '../position.js';
import { Range } from '../range.js';
import { AbstractScannerFactory, Repository, Scanner, ScannerFactory } from '../scanner.js';
import { Signal } from '../signal.js';


export function computeLPSArray(pat) {
  // https://www.geeksforgeeks.org/kmp-algorithm-for-pattern-searching/
  // length of the previous longest prefix suffix
  var len = 0;
  var i = 1;
  let lps = new Array(pat.length);
  lps[0] = 0; // lps[0] is always 0

  // the loop calculates lps[i] for i = 1 to M-1
  while (i < pat.length) {
    if (pat.charAt(i) == pat.charAt(len)) {
      len++;
      lps[i] = len;
      i++;
    }
    else // (pat[i] != pat[len])
    {
      // This is tricky. Consider the example.
      // AAACAAAA and i = 7. The idea is similar
      // to search step.
      if (len != 0) {
        len = lps[len - 1];
      } else {
        lps[i] = len;
        i++;
      }
    }
  }
  return lps;
}

const toDataToken = (item: { data: string, index: number}): DataToken => {
  return new DataToken(Position.absolute(item.index), item.data); 
}

type OutputType = { source: 'START' | 'DATA' | 'END', item: any, index: number };
const OutputPriorities = {
  'START': 0,
  'DATA': 1,
  'END': 2
}

export class Match implements Scanner<string, Range.ReadOutput[]> {

  id: string
  toMatch: string
  inclusive: boolean
  holding: Queue<{ data: string, index: number }>
  outputStartEvents: Queue<Event.Start>
  outputEndEvents: Queue<Event.End>
  outputData: Queue<{ data: string, index: number }>
  nextOutput: Heap<OutputType>
  lastMatched: { queued: Queue<Event.Start>, data: string }
  lpsArray: number[]
  closedIndex: number
  lastObserved: number
  completed: boolean
  terminal: Signal<Range.ReadOutput[], number>
  state: any
  toEmit: Range.ReadOutput[]

  constructor(
    toMatch: string,
    inclusive: boolean = true,
    id?: string) {

    this.id = id ||= toMatch;
    this.toMatch = toMatch;
    this.inclusive = inclusive;
    this.lpsArray = computeLPSArray(toMatch);
    this.lastMatched = { queued: new Queue<Event.Start>(), data: '' } ;
    this.holding = new Queue<{ data: string, index: number }>();
    this.outputStartEvents = new Queue<Event.Start>();
    this.outputEndEvents = new Queue<Event.End>();
    this.outputData = new Queue<{ data: string, index: number }>();
    this.nextOutput = new Heap<OutputType>(
      (a: OutputType, b: OutputType) => {
        if (a.index > b.index) {
          return 1
        } else if (a.index === b.index) {
          if (OutputPriorities[a.source] > OutputPriorities[b.source]) {
            return 1;
          } else if (OutputPriorities[a.source] === OutputPriorities[b.source]){
            return 0;
          } else {
            return -1;
          }
        } else {
          return -1;
        }
      });

    this.closedIndex = -1;
    this.completed = false;
    this.terminal = null;
    this.toEmit = [];
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

    if (this.toEmit.length > 0) {
      result.value.data = this.toEmit;
      this.toEmit = [];
    }

    // Cache the completed result so re-calls after completion return the same signal.
    // Previously JSON.parse(JSON.stringify(result)) — which destroyed class instances
    // (DataToken, Event.Start, Event.End) in value.data, breaking instanceof checks
    // downstream. The terminal is only read back, never mutated, so a reference is safe.
    if (this.completed) this.terminal = result;
    return result;
  }

  private close() {
    this.closedIndex = this.lastObserved;
    this.completed = true;
  }

  addStart(startEvent: Event.Start) {
    this.outputStartEvents.push(startEvent);
    this.nextOutput.push({ source: 'START', item: startEvent.name, index: startEvent.position });
  }

  addEnd(endEvent: Event.End) {
    this.outputEndEvents.push(endEvent);
    this.nextOutput.push({ source: 'END', item: endEvent.name, index: endEvent.position });
  }

  addData(data: { data: string, index: number }) {
    this.outputData.push(data);
    this.nextOutput.push({ source: 'DATA', item: data, index: data.index });
  }

  createStartEvent(initialPosition: Position) {
    return Event.start(`match:${this.toMatch}`, initialPosition, {
      source: this.id, operation: `match`, arguments: this.toMatch
    });
  }

  createEndEvent(initialPosition: Position) {
    return Event.end(`match:${this.toMatch}`, initialPosition)
  }

  print(tabs: number = 0) {
    const times = (num: number, str: string) => {
      let result = '';
      for (let i = 0; i < num; i++) result += str;
      return result;
    }
    let output = `${times(tabs, '\t')}Match:${this.id}\n`;
    return output;
  }


  shift(signal: Signal<string, number>): Signal<Range.ReadOutput[], number> {

    if (this.completed) return this.terminal;
    if (signal.done) this.close();


    if ((signal.value === undefined) || (signal.value.data === undefined)) {
      if (this.holding.length > 0) this.closedIndex = this.holding.last.data.index
      this.holding.clear();
      this.close();
      if ((signal.value !== undefined) && (signal.value.index !== undefined)) this.lastObserved = signal.value.index;
      return this.getReturnValue();
      
    } else {

      let charIndex = 0;
      let nextIndex = signal.value.index + charIndex;
      while (nextIndex < this.closedIndex && charIndex < signal.value.data.length) {
        charIndex += 1;
        nextIndex = signal.value.index + charIndex;
      }

      while (charIndex < signal.value.data.length) {
        let run = true;
        
        this.holding.push({ index: nextIndex, data: signal.value.data.charAt(charIndex) });

        while (this.holding.length > 0 && run) {

          let nextExpected = this.toMatch.charAt(this.holding.length-1);
          let nextValue = signal.value.data.charAt(charIndex);
          let terminal = (this.holding.length === this.lpsArray.length);
          let matched = nextExpected === nextValue;

          if (!matched || (matched && terminal)) {

            if ((matched && terminal)) {
              if (this.inclusive || this.nextOutput.length < 1) {
                let initialPosition = Position.absolute(this.holding.peak().index); 
                this.addStart(this.createStartEvent(initialPosition))
                this.addEnd(this.createEndEvent(Position.absolute(nextIndex)))
                this.closedIndex = nextIndex;
              }

              let newLength;
              if (!matched || (matched && terminal)) {
                newLength = this.lpsArray[this.holding.length-1];
              } else {
                newLength = 0;
              }
              while (this.holding.length > newLength) {
                let shifted = this.holding.shift();
                this.addData(shifted);
                this.closedIndex = shifted.index;
              }
              break;
            }
            
            let newLength;
            if (!matched || (matched && terminal)) {
              newLength = this.lpsArray[this.holding.length-1];
            } else {
              newLength = 0;
            }

            if (this.holding.length > newLength) {
              let shifted = this.holding.shift();
              this.addData(shifted);
              this.closedIndex = shifted.index;
            }
          } else {
            run = false;
          }
        }
        charIndex += 1;
        nextIndex = signal.value.index + charIndex;
      }
    }

    while (this.nextOutput.length > 0 && this.nextOutput.peek().index <= this.closedIndex) {
      let targetIndex = this.nextOutput.peek().index;
      while (this.nextOutput.length > 0 && this.nextOutput.peek().index === targetIndex) {
        let val = this.nextOutput.pop();
        if (val.source === 'START') {
          let startEvent = this.outputStartEvents.shift();
          this.lastMatched.queued.push(startEvent);
          this.toEmit.push(startEvent);
        } else if (val.source === 'DATA') {
          if (this.lastMatched.queued.length > 0) {
            this.toEmit.push(toDataToken(this.outputData.shift())); 
          } else {
            this.outputData.shift();
          }
        } else {
          let endEvent = this.outputEndEvents.shift();
          this.lastMatched.queued.shift();
          this.toEmit.push(endEvent);
        }
      }
      // do anything to close batches here (even though we aren't)
    }

    if ((signal.value !== undefined) && (signal.value.index !== undefined)) this.lastObserved = signal.value.index;
    
    return this.getReturnValue();
  }

  static create(str) {
    return new Match(str);
  }

  public static factory(str: string) {
    return new AbstractScannerFactory(`${str}`, 'match', (repository: Repository) => {
      let match = new Match(str);
      return match;
    }) as ScannerFactory<string, Range.ReadOutput[]>;
  }
}

