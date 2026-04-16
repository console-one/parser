import { Logs } from '../vendor/generics/log.js';
import { DataToken } from '../datatoken.js';
import { Event } from '../event.js';
import { Range } from '../range.js';
import { Signal } from '../signal.js';
import { Queue, QueueItem } from '../vendor/generics/queue.js';
import { Interval } from './../interval.js';
import { Position } from './../position.js';
import { AbstractScannerFactory, Repository, Scanner, ScannerFactory } from './../scanner.js';
import { tokenstring } from './../utils.js';
import { Race } from './race.js';
import { SearchState, SearchStateFactory, SearchEvent } from './searchstate.js';
import { times, underride } from '../vendor/generics/functions.js'
import { IncrementalSink } from '../incremental.js';
import { Link } from '../vendor/generics/link.js';
import { IndexMap } from '../vendor/generics/indexmap.js';

/**
 * Runs multiple searches across an input stream.
 * 
 * Effectively, each input Scanner is a sliding window: 
 * For all Scanners which share the same closed index, feed input incrementally. 
 * 
 * More in server/notes/race-scanner.md
 */


class Listener {

  callbacks: IndexMap<any>

  constructor() {
    this.callbacks = new IndexMap<any>();
  }

  get length(): number {
    return this.callbacks.size;
  }

  observe(callback: (err: Error, data?: any, cancel?: () => any | void) => any | void) {
    let locked = this.callbacks.lock();
    return this.callbacks.set(locked, (err: Error, data?: any, cancel?) => {
      if (err !== undefined && err !== undefined) {
        this.callbacks.delete(locked);
        callback(err)
      } else {
        let cancelled = false;
        callback(null, data, () => {
          if (!cancelled) {
            cancelled = true;
            return cancel(() => {
              if (!cancelled) {
                cancelled = true;
              }
              let val = this.callbacks.delete(locked)
              return val
            })
          }
        })
      }
      let cancelled = false;
      return () => {
        if (!cancelled) {
          cancelled = true;
          return cancel(() => {
            if (!cancelled) {
              cancelled = true;
            }
            let val = this.callbacks.delete(locked)
            return val
          })
        }
      }
    })
  }

  resolve(val: any) {
    let errors = [];
    for (let item of this.callbacks.values()) {
      try {
        item(null, val)
      } catch (err) {
        console.error("Error: ", err);
        errors.push(err);
      }
    }
    if (errors.length > 0) throw new Error("Error resolving before and after hooks!")
  }

}


class Hooks {

  root: {
    beforeAllHooks: Listener,
    afterAllHooks: Listener
  }

  beforeHooks: Listener
  afterHooks: Listener

  beforeGroups: number
  afterGroups: number

  constructor() {
    this.root = {
      beforeAllHooks: new Listener(),
      afterAllHooks: new Listener(),
    };
    this.beforeHooks = new Listener();
    this.afterHooks = new Listener();

    this.beforeGroups = 0;
    this.afterGroups = 0;
  }

  addBeforeAllHook(cb) {
    return this.root.beforeAllHooks.observe(cb);
  }

  addBeforeHook(cb: any) {
    return this.beforeHooks.observe(cb);
  }

  addAfterAllHook(cb) {
    return this.root.afterAllHooks.observe(cb);
  }

  addAfterHook(cb: any) {
    return this.afterHooks.observe(cb);
  }


  callBeforeHooks(key, value, ...data) {
    let beforeHookGroup = this.beforeGroups;
    this.beforeGroups += 1;
    this.root.beforeAllHooks.resolve(['start', beforeHookGroup])
    this.beforeHooks.resolve([beforeHookGroup, [key, value, ...data]])
    this.beforeHooks.resolve([beforeHookGroup, null])
    this.root.beforeAllHooks.resolve(['end', beforeHookGroup]);
  }

  callAfterHooks(key, value, ...data) {
    let afterHookGroup = this.afterGroups;
    this.afterGroups += 1;
    this.root.afterAllHooks.resolve(['start', afterHookGroup])
    this.afterHooks.resolve([afterHookGroup, [key, value, ...data]])
    this.afterHooks.resolve([afterHookGroup, null])
    this.root.afterAllHooks.resolve(['end', afterHookGroup])
  }
}

export class Search implements Scanner<string, Range.ReadOutput[]> {

  id: string
  rootInterval: Interval
  lastInterval: Interval
  lastData: DataToken
  lastObserved: 'EVENT' | 'DATA' | 'NONE'

  stateFactory: SearchStateFactory
  state: SearchState
  previous: SearchState[]
  scanner: Scanner<string, Range.ReadOutput[]>

  count: number
  buffer: Queue<DataToken>
  startEvents: Queue<Event>
  endEvents: Queue<Event>
  inputFinished: boolean
  completed: boolean
  processing: boolean

  terminal: Signal<Range.ReadOutput[], number>
  lastInputIndex: number

  lookaheadClosedIndex: number

  closedIndex: number
  table: Repository
  toReturn: Range.ReadOutput[]
  logs: Logs
  lookaheadStateFactory: SearchStateFactory
  lookaheadState: SearchState

  incremental?: IncrementalSink
  links: { [key: string]: Link }
  hooks: Hooks
  ancestors: any = {}

  constructor(initial: string, table: Repository, id: string, incremental?: IncrementalSink) {
    this.id = id;
    this.lookaheadClosedIndex = -1;
    this.table = table;
    this.stateFactory = this.table.get(initial);
    this.count = 0;
    this.inputFinished = false;
    this.previous = [];
    this.buffer = new Queue<DataToken>();
    this.startEvents = new Queue<Event>();
    this.endEvents = new Queue<Event>();
    this.completed = false;
    this.processing = false;
    this.terminal = null;
    this.toReturn = [];
    this.lastInputIndex = -1;
    this.closedIndex = -1;
    this.lastObserved = 'NONE';
    this.logs = new Logs('search');
    this.table.logger = this.logs;

    if (incremental !== undefined && typeof (incremental as any).resolve === 'function') {
      this.incremental = incremental;
    }
    this.hooks = new Hooks();

    this.ancestors = {}
  }

  print(tabs: number = 0) {
    let output = `${times(tabs, '\t')}Search:${this.id}[\n`;
    for (let scanner of (this.scanner as Race).scannerNamesToScanners.values()) output += scanner.print(tabs + 1);
    return output + times((tabs + 1), '\t') + ']\n'; ''
  }

  logState() {
    this.logs.write("This state: ", this.startEvents.toArray());
    this.logs.write("This end events: ", this.endEvents.toArray());
    // this.logs.write("This data: ", this.buffer.toArray());
    this.logs.write("This lookahead: ", this.state.lookahead.print());
  }

  complete() { return this.completed };

  hasData(signal: Signal<string, number>): boolean {
    return (signal.hasOwnProperty('value') && signal.value.hasOwnProperty('data'))
  }

  getReturnValue() {
    let result: any = { done: this.completed, value: { index: this.closedIndex } }
    result.value.data = this.toReturn;
    this.toReturn = [];
    if (this.completed) {
      // See Match: caching the result (not a JSON clone) preserves class instances.
      this.terminal = result;
      this.logs.clear();
    }
    return result;
  }

  getTokens(signal: Signal<string, number>) {
    let results = new Queue<DataToken>();
    for (let charIndex = 0; charIndex < signal.value.data.length; charIndex++) {
      results.push(DataToken.from(this.lastInputIndex + 1 + charIndex, signal.value.data.charAt(charIndex)));
    }
    return results;
  }

  signalBeforeHook(key, value, ...data) {
    this.hooks.callBeforeHooks(key, value, ...data)
  }

  signalAfterHook(key, value, ...data) {
    this.hooks.callAfterHooks(key, value, ...data)
  }

  addOutput(data: Event) {
    this.signalAfterHook('addOutput', 'push', data)

    this.logs.write(`OUTPUTTING ${tokenstring(data)}`);
    let outputType: 'EVENT' | 'DATA' = Event.describes(data) ? 'EVENT' : 'DATA';
    if (outputType === 'DATA') {
      let datatoken = data as unknown as DataToken;
      if (this.lastObserved === 'DATA') {
        this.lastData = new DataToken(this.lastData.start, this.lastData.text + datatoken.text);
      } else this.lastData = DataToken.from(datatoken.start.get(), datatoken.text)
    } else {
      if (this.lastObserved === 'DATA') {

        this.lastInterval.appendChild(this.lastData);
        this.logs.write("Last Data: ", this.lastData);
        if (this.state !== undefined) this.state.apply(new SearchEvent(this.lastData));
        if (this.incremental !== undefined) {
          this.incremental.resolve({
            kind: 'token',
            data: this.lastData.text ?? (this.lastData as any).data,
            position: this.lastData.start,
            updated: this.lastInterval.link
          });
        }

        this.lastData = undefined;
      }
      let event = data as Event;
      if (event.kind === 'start') {

        let start = event as Event.Start;
        if (this.lastInterval === undefined) {
          this.lastInterval = new Interval(Position.absolute(start.position), start.name);
          this.rootInterval = this.lastInterval;
        } else {
          let position = Position.absolute(start.position);
          let nextInterval = new Interval(position, start.name, start.metadata);

          this.signalBeforeHook(this.lastInterval, 'appendChild', nextInterval)
          this.lastInterval.appendChild(nextInterval);
          this.lastInterval = nextInterval;

        }
        this.lastInterval.link = new Link();
        if (this.incremental !== undefined) {
          this.incremental.resolve({
            kind: 'start',
            name: this.lastInterval.name,
            metadata: underride({}, this.lastInterval.startEvent.metadata ?? {}),
            position: this.lastInterval.startEvent.position,
            updated: this.lastInterval.link,
            uuid: this.lastInterval.instanceId
          });
        }

      } else if (event.kind === 'end') {
        if (event.name !== this.lastInterval.startEvent.name) {
          //throw new Error(`Event starts and ends not matching!`);
        }
        this.state.apply(new SearchEvent(this.lastInterval));

        // if (this.lastInterval.metadata !== undefined && this.lastInterval.metadata.runtime !== undefined) {

        //   let aspects = [
        //     this.lastInterval.metadata?.runtime?.instanceId,
        //     this.lastInterval.metadata?.runtime?.dependencyPath,
        //     this.lastInterval.metadata?.runtime?.dependencyParams,
        //     this.lastInterval.metadata?.encoding,
        //     this.lastInterval.metadata?.mode
        //   ]

        //   // let trace = this.
        //   // while (trace !== undefined) {

        //   //   if (trace !== undefined) this.ancestors[trace] = { descendants: {} }
        //   let uuid = this.lastInterval.metadata.runtime.instanceId;

        //   this.ancestors[uuid] = {
        //     metadataInstanceId: this.lastInterval.metadata.runtime.instanceId,
        //     dependencyPath: this.lastInterval.metadata.runtime.dependencyPath,
        //     dependencyParams: this.lastInterval.metadata.runtime.dependencyParams,
        //     encoding: this.lastInterval.metadata.encoding,
        //     mode: this.lastInterval.metadata.mode,
        //     instanceId: this.lastInterval.instanceId,
        //     startPosition: this.lastInterval.start.get(),
        //     endPosition: this.lastInterval.end.get()
        //   }

        //   console.log("Storing: ", this.ancestors[uuid])
        // }



        this.lastInterval.link.onReceiver(rec => rec(this.lastInterval.metadata))

        if (this.incremental !== undefined) {
          this.incremental.resolve({
            kind: 'end',
            name: this.lastInterval.name,
            position: this.lastInterval.endEvent.position,
            uuid: this.lastInterval.instanceId
          });
        }

        this.lastInterval = this.lastInterval.parent as Interval;

      } else {
        this.logs.write("Error data: ", data);
        throw new Error(`No idea how to handle data!`)
      }
    }
    this.lastObserved = outputType;
    this.toReturn.push(data);
    this.signalAfterHook('addOutput', 'push', data)

  }

  clearBuffer(ignore: boolean = false) {
    let bufferItem = this.buffer.first;
    let sink = ignore ? (data: any) => { } : this.addOutput.bind(this);
    while (bufferItem !== undefined && bufferItem.data.start.get() <= this.lookaheadClosedIndex) {
      while (this.endEvents.length > 0 && this.endEvents.peak().position < bufferItem.data.start.get()) sink(this.endEvents.shift());
      while (this.startEvents.length > 0 && this.startEvents.peak().position <= bufferItem.data.start.get()) sink(this.startEvents.shift());
      sink(bufferItem.data);
      this.buffer.shift();
      bufferItem = this.buffer.first;
    }
    while (this.endEvents.length > 0 && this.endEvents.peak().position <= this.lookaheadClosedIndex) sink(this.endEvents.shift());
  }

  // TODO: fix this to enable multiple pushes at once
  pushState(name) {
    this.stateFactory = this.table.get(name, this.stateFactory);
    this.previous.push(this.state);
    this.state = undefined;
  }

  endState() {
    let endEvent = Event.end(this.state.id, Position.absolute(this.lookaheadClosedIndex));
    this.addOutput(endEvent);
  }

  popState(iterations: number = 1) {
    while (iterations > 0 && !this.completed) {

      this.endState();
      if (this.previous.length > 0) {
        this.state = this.previous.pop();
        this.stateFactory = this.state.type;
        this.state.lookahead = this.stateFactory.lookaheadFactory(this.table);
        this.state.lastConsumed = undefined;

        this.logs.write("LOOKAHEAD FACTORY IS: ", this.stateFactory.lookaheadFactory);
        this.logs.write("Lookahead revived is: ", this.state.lookahead);
        this.startEvents.clear();
        this.endEvents.clear();
        this.logs.write("Lookahead closed index is: ", this.lookaheadClosedIndex);
        this.clearBuffer(true);

        if (this.buffer.first !== undefined) this.logs.write("BUFFER FIRST IS", this.buffer.first.data)
        else this.logs.write("BUFFER IS EMPTY!")
      } else {
        this.lookaheadClosedIndex = this.lastInputIndex;
        this.closedIndex = this.lookaheadClosedIndex;
        this.completed = true;
        this.clearBuffer();
        break;
      }
      iterations--;
    }
  }

  transition(): QueueItem<DataToken> {
    this.logs.write(`CLEARING BUFFER`)
    this.clearBuffer();
    let lastEnd = this.endEvents.last.data;
    this.logs.write(`TRANSITION TO ${lastEnd.name}`);
    if (this.state.transitionBounds.get(lastEnd.name) === 'AFTER') {
      this.lookaheadClosedIndex = lastEnd.position;
      this.closedIndex = lastEnd.position;
      this.clearBuffer();
    } else {
      this.startEvents.shift();
      this.endEvents.shift();
    }

    for (let operation of this.state.transitionMap.get(lastEnd.name)) {

      this.logs.write("Pushing: ", operation.type);

      if (operation.type === 'PUSH') {
        this.pushState(operation.args[0]);
      } else if (operation.type === 'POP') {
        let iterations = (operation.args.length < 1) ? 1 : Number(operation.args[0]);
        this.popState(iterations);
        this.logs.write("POPPED: ", operation)
      } else if (operation.type === 'GOTO') {
        this.popState();
        this.logs.write("POPPED FOR GOTO: ", operation)
        this.pushState(operation.args[0]);
        this.logs.write("STATE PUSHED: ", operation.args[0]);
      }
    }

    return this.buffer.first;
  }

  startLookahead(lookahead: Event.Start) {
    this.startEvents.push(lookahead);
    this.processing = true;
    this.count = 1;
  }

  processLookahead(lookahead: Event | DataToken) {
    // todo
  }

  endLookahead(event: Event) {
    this.endEvents.push(event);
    this.processing = false;
    this.lookaheadStateFactory = undefined;
    this.lookaheadState = undefined;
  }

  setStart(position: Position) {
    let startEvent = Event.start(this.stateFactory.id, position);
    let lastState = this.previous.length > 0 ? this.previous[this.previous.length - 1] : undefined;
    this.addOutput(startEvent);

    this.state = this.stateFactory.create(startEvent, this.table, lastState);
    this.logs.write('SET STATE": ', this.state)
    this.logs.write("SET LOOKAHEAD: ", this.stateFactory.lookaheadFactory);
  }

  findLookaheadStart(result, processingState, resultItems) {
    // find next start state and set the closed index to  everything proceeding
    let nextClosedIndex = this.lookaheadClosedIndex;
    if (result.value.data !== undefined) {
      while (resultItems.length > 0) {
        let nextItem = resultItems.shift();
        if (Event.describes(nextItem)) {
          processingState = false;
          this.logs.write(`LOOKAHEAD ${tokenstring(nextItem)}`);
          this.startLookahead(nextItem as Event.Start);
          break;
        } else {
          this.logs.write(`NEXT IS IS: `, nextItem, "LOOKAHEAD INDEX IS: ", result.value.index);
          nextClosedIndex = (nextItem as DataToken).start.get();
        }
      }
    }
    this.lookaheadClosedIndex = Math.min(nextClosedIndex, result.value.index);
    return {
      isProcessing: processingState,
      resultItems: resultItems,
      result: result
    }
  }

  findTermination(resultItems, processingState, bufferItem) {
    // ignore data tokens since they are already in the buffer 
    // count start and end events until an end for the start is found, then
    // launch the state transition. If we have the guarantee the output 
    // does not emit a single event beyond the lookahead start and end data
    // then we could ignore this filtering step. 
    //
    // TODO: Remove filtering from here and put in seperate scanner
    while (resultItems.length > 0) {
      let nextItem = resultItems.shift();
      this.logs.write(`LOOKAHEAD ${tokenstring(nextItem)}`);
      this.processLookahead(nextItem);
      if (Event.describes(nextItem)) {
        let event = nextItem as Event;
        if (event.kind === 'end' && event.name === this.startEvents.peak().name) {
          this.count -= 1;
          if (this.count === 0) {
            // this state should be closing 
            this.logs.write("ENDING LOOKAHEAD")
            this.endLookahead(nextItem as Event);

            // here we are state transitioning
            bufferItem = this.transition();
            resultItems.clear();
            processingState = false;
            break;
          }
        } else if (event.kind === 'start' && event.name === this.startEvents.peak().name) {
          this.count += 1;
        }
      }
    }
    return {
      result: resultItems,
      isProcessing: processingState,
      bufferItem: bufferItem
    }
  }

  processBuffer() {

    let bufferItem;

    // assign the state to last one consumed
    // or the first item in the buffer
    if (this.state === undefined) bufferItem = this.buffer.first;
    else {
      if (this.state.lastConsumed !== undefined) bufferItem = this.state.lastConsumed.next;
      if (bufferItem === undefined) bufferItem = this.buffer.first;
    }

    // for each buffer item 
    while (bufferItem !== undefined) {

      // launch the state if it is undefined. 
      if (this.state === undefined) this.setStart(bufferItem.data.start);

      // set the next output signal values. TODO: move to a private method. 
      let nextSignal: any = {};
      nextSignal.done = (this.inputFinished && bufferItem.next === undefined);
      nextSignal.value = { index: bufferItem.data.start.get(), data: bufferItem.data.text };

      // mark the next buffer item as the last consumed by the state
      this.logs.write(`FEEDING DATA[${bufferItem.data.text}] ${bufferItem.data.start.get()}`);
      this.state.lastConsumed = bufferItem;

      // get the next lookahead value for this item, telling the lookahead the state 
      // is closing if it is. 
      let result = this.state.lookahead.shift(nextSignal);

      // data only exists when a token is found - so the last lookahead is the current 
      // choice for the next state transition
      if (result.value.data !== undefined) {
        // iterate through the response tokens, which may contain some event labels 
        // note this means the 'tail' of our processing will be out of sync with the 
        // last buffer item.
        // TODO: Make them sync - filter the scanner output for event type tokens and
        // increment the existing buffer item between them. 
        let resultItems = Queue.of(...result.value.data);
        for (let resultItem of resultItems) this.logs.write(`LOOKRETURN ${tokenstring(resultItem)}`);
        let started = true;
        while (resultItems.length > 0) {
          this.logs.write(`PROCESSING ${tokenstring(resultItems.peak())}, in mode: `, this.processing);
          if (this.processing) {
            let state = this.findTermination(resultItems, started, bufferItem)
            resultItems = state.result;
            started = state.isProcessing;
            bufferItem = state.bufferItem;
          } else {
            let state = this.findLookaheadStart(result, started, resultItems)
            resultItems = state.resultItems
            result = state.result;
            started = state.isProcessing;
          }
        }

        this.logs.write("IS NOW PROCESSING: ", this.processing);
        if (this.processing || started) bufferItem = bufferItem.next;
      } else if (!this.processing) {
        this.closedIndex = this.lookaheadClosedIndex;
        this.lookaheadClosedIndex = result.value.index;
        this.state.aggregations
        bufferItem = bufferItem.next;
      } else {
        this.logState();
        throw new Error(`Error!`)
        // this.clearBuffer();
      }
    }
    this.clearBuffer();
  }

  shift(signal: Signal<string, number>): Signal<Range.ReadOutput[], number> {
    try {
      if (this.completed) return this.terminal;
      if (signal.done) this.inputFinished = true;
      if (this.hasData(signal)) {
        this.logs.write("NEW BUFFER DATA ADDED FROM: ", JSON.stringify(signal, null, 2));

        // test add data to buffer.
        this.buffer = this.buffer.concat(this.getTokens(signal));

        // track next head
        if (signal.value !== undefined) this.lastInputIndex = signal.value.index;

        // dequeue
        this.processBuffer();
      }
      // if all processed
      if (signal.done) {
        this.logs.write("PROCESSING TERMINAL")
        this.toReturn = [];
        this.completed = true;
        this.closedIndex = this.lastInputIndex;
        if (this.state !== undefined) {
          while (this.lastInterval !== undefined) {
            this.addOutput(Event.end(this.lastInterval.name, Position.absolute(this.lastInputIndex)));
          }
        }
        this.lastData = undefined;

      }
      let returnValue = this.getReturnValue();
      return returnValue;
    } catch (err) {
      this.logs.write(err.stack);
      this.logs.error();
      throw err;
    }
  }

  public static factory(initial: string, table: Repository, id: string) {
    return new AbstractScannerFactory(id, 'selector', (repository: Repository) => {
      let searchable = new Search(initial, table, id)
      if (searchable === undefined) {
        console.error(`Cannot find required input stream: ${initial} ${id}`);
        throw new Error(`Cannot find required input stream:  ${initial} ${id}`);
      }
      return searchable;
    }) as ScannerFactory<string, Range.ReadOutput[]>;
  }
}


