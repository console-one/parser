import { Heap } from 'heap-js';
import { HeapMultimap } from '@console-one/multimap';
import { Event } from '../event.js';
import { Range } from '../range.js';
import { Signal } from '../signal.js';
import { AbstractScannerFactory, Repository, Scanner, ScannerFactory } from './../scanner.js';

export const createPrioritization = <KeyType>(order: Map<KeyType, number>) => {
  return (a: KeyType, b: KeyType) => {
    if (order.get(a) > order.get(b)) return 1;
    if (a === b) return 0;
    return -1;
  }
}

export const pivotByOrder = <A, K>(arr: A[], extract: (input: A) => K) => {
  return arr.map((item, index) => [item, index] as [key: A, name: number])
            .reduce((map, item: [key: A, name: number]) => {
              map.set(extract(item[0]), item[1]);
              return map;
            }, new Map<K, number>())
}

/**
 * Runs multiple searches across an input stream.
 * 
 * Effectively, each input Scanner is a sliding window: 
 * For all Scanners which share the same closed index, feed input incrementally. 
 * 
 * More in server/notes/race-scanner.md
 * 
 */
export class Race implements Scanner<string, Range.ReadOutput[]> {

  /**
   * String
   * The ID of this race lexer which could be used to index it
   * within other race lexers. 
  */
  id: string

  /**
   *  Map<string, Scanner<string, Range.ReadOutput[]>>
   * The scanners we are 'racing' within this scanner in order to
   * find the next token. 
   */
  scannerNamesToScanners: Map<string, Scanner<string, Range.ReadOutput[]>>;
 
  /**
   * HeapMultimap<number, string> 
   * A map keyed by numbers representing indexes within the input
   * character stream. The values of the map are a sorted list
   * of the names of scanners which are blocked until receiving the
   * character located at the index of their map key.
   */
  scannerNamesByLastProcessedIndex: HeapMultimap<number, string>;

  /**
   * Map<string, number>
   * A map from scanner name to the highest value 
   * character index it has read from the input
   */
  scannerNameToLastInputIndexConsumed: Map<string, number>;
  
  /** 
   * Heap<number>
   * A Heap of numbers representing the indices 
   * different lexers are blocked at within the input
   * character stream.
   */
  allScannerLastProcessedIndexes: Heap<number>

  /**
   * Integer
   * An integer of the last evicted index blocking a scanner from
   * the min heap. This index, and all before it, inclusive, have
   * been completely processed by this lexer.
  */
  closedIndex: number

  /**
   * Map<number, { index: number, data?: string }>
   * A map of the indexes within the input character stream to the
   * contiguous data input observed at those indexes.
   */
  data: Map<number, { index: number, data?: string }>

  /**
   * Map<number, number>
   * Each number associated with some input data in the input stream,
   * to the number which succeeded it in the stream.
   */
  nextNumbers: Map<number, number>

  /**
   * Map<number, number>
   * Each number associated with some input data in the input stream,
   * to the number which proceeded it in the stream.
   */
  prevNumbers: Map<number, number>

  /**
   * Integer
   * The last value observed in the input sequence (consequently the largest). 
   * The only number as value but not key in the 'next numbers' map.
   */
  lastObserved: number

  /**
   * Map<string, number>
   * Different input types to a number representing priority in heap. Need to 
   * evaluate how this is used. 
   */
  order: Map<string, number>

  /**
   * 
   * the matchers which have completed at the current index
   */
  currentCompletions: Map<string, Signal<Range.ReadOutput[], number>>

  /**
   * Boolean -
   * Whether this lexer has been fed all its input and now terminated. 
  */
  completed: boolean

  /**
   * Signal<Range.ReadOutput[], number> - 
   * The last returned value after the output is found. Re-emitted any subsequent time 
   * this scanner is called.
   */
  terminal: Signal<Range.ReadOutput[], number>

  /**
   * SEARCHING | FEEDING
   * If a race result has been concluded, but we are waiting for the terminal
   * token of the definite winning 'lexer' of the race, we place this scanner
   * into a state of 'feeding', since the incorporate of the winning lexers
   * inner logic into this lexers state is forbidden.
   */
  state: 'SEARCHING' | 'FEEDING'

  constructor(scanners: Scanner<string, Range.ReadOutput[]>[], id?: string) {
    this.completed = false;
    this.terminal = null;
    this.id = ((id !== undefined) && (id !== null)) ? id : scanners.map(matcher => matcher.id).join('||=');
    this.scannerNamesToScanners = new Map<string, Scanner<string, Range.ReadOutput[]>>();
    
    this.order = pivotByOrder(scanners, (input) => input.id);
    this.scannerNamesByLastProcessedIndex = new HeapMultimap<number, string>(createPrioritization<string>(this.order));
    this.scannerNameToLastInputIndexConsumed = new Map<string, number>();
    this.allScannerLastProcessedIndexes = new Heap();
    this.nextNumbers = new Map<number, number>();
    this.prevNumbers = new Map<number, number>();
    this.data = new Map<number, { index: number, data?: string }>();
    this.closedIndex = -1;
    this.lastObserved = -1;
    this.allScannerLastProcessedIndexes.push(-1);
    this.currentCompletions = new Map<string, Signal<Range.ReadOutput[], number>>();
    this.state = 'SEARCHING';

    for (let scannerIndex = 0; scannerIndex < scanners.length; scannerIndex++) {
      let scanner = scanners[scannerIndex];
      this.scannerNamesToScanners.set(scanner.id, scanner);
      this.scannerNamesByLastProcessedIndex.set(-1, scanner.id);
      this.scannerNameToLastInputIndexConsumed.set(scanner.id, -1);
    }
  }

  print(tabs: number = 0) {
    const times = (num: number, str: string) => {
      let result = '';
      for (let i = 0; i < num; i++) result += str;
      return result;
    }
    let output = `${times(tabs, '\t')}RaceScanner:${this.id}[\n`;
    for (let scanner of this.scannerNamesToScanners.values()) output += scanner.print(tabs + 1);
    output += times((tabs + 1), '\t') +']\n';
    return output;
  }

  complete() { return this.completed; }

  applyLabels(result: Range.ReadOutput[]) {
    let after = result.map(item => {
      if (Event.describes(item) && (item as Event).kind === 'start') {
        let event = item as Event.Start;
        event.metadata.source = this.id;
        return event as Event;
      } else {
        return item;
      }
    });
    return after
  }

  shift(signal: Signal<string, number>): Signal<Range.ReadOutput[], number> {

    if (this.completed) return this.terminal;

    if (signal.done && !(signal.hasOwnProperty('value') && signal.value.hasOwnProperty('data'))) {
      if (this.allScannerLastProcessedIndexes.length > 0
        && this.scannerNamesByLastProcessedIndex.has(this.allScannerLastProcessedIndexes.peek())) {
        let lastCompletionIndex = this.allScannerLastProcessedIndexes.peek();
        let subsearchId = this.scannerNamesByLastProcessedIndex.get(lastCompletionIndex).peek();
        let searchFindings = this.scannerNamesToScanners.get(subsearchId).shift({  done: true,  
          value: { index: this.lastObserved } });

        if (searchFindings.hasOwnProperty('value') && searchFindings.value.hasOwnProperty('data')) {
          return searchFindings;
        } else {
          return this.close();
        }
      } else {
        return this.close();
      }
    }

    let token: { index: number, data?: string } = signal.value;
    this.setTokenIndexMappings(token);
    let attempted = false;

    while (this.allScannerLastProcessedIndexes.length > 0
      && this.scannerNamesByLastProcessedIndex.has(this.allScannerLastProcessedIndexes.peek())
      && !attempted) {

      attempted = true;
      
      let lastCompletionIndex = this.allScannerLastProcessedIndexes.peek();

      let nextCompletionIndex;
      if (this.nextNumbers.has(lastCompletionIndex)) nextCompletionIndex = this.nextNumbers.get(lastCompletionIndex);

      let subsearchId = this.scannerNamesByLastProcessedIndex.get(lastCompletionIndex).peek();

      while (this.nextNumbers.has(this.scannerNameToLastInputIndexConsumed.get(subsearchId)) && attempted) {


        let lastObserved = this.scannerNameToLastInputIndexConsumed.get(subsearchId);
        let nextIndexToObserve = this.nextNumbers.get(lastObserved);
        this.scannerNameToLastInputIndexConsumed.set(subsearchId, nextIndexToObserve);

        let token = this.data.get(nextIndexToObserve);
        let aboutToShift = {
          done: signal.done,
          value: token
        };

        let searchFindings = this.scannerNamesToScanners.get(subsearchId).shift(aboutToShift);
        let newSubsearchCompletionIndex;
        if (searchFindings.value.hasOwnProperty('data')
          && searchFindings.value.data !== undefined) {
          let toReturn = [];
          let result = searchFindings.value.data;
          let lastFed;

          let processInState = (item) => {
            if (this.state === 'SEARCHING') {
              if (Event.describes(item) && (item as Event).kind === 'start') {
                this.state = 'FEEDING';
                lastFed = (item as Event).position;
                toReturn.push(item);
              }
            } else if (this.state === 'FEEDING') {
              toReturn.push(item);
              if (Event.describes(item) && 
                  (item as Event).kind === 'end') {
                  this.state = 'SEARCHING';
              }
              lastFed = (item as Event).position;
            }
          }

          let awaitingFinish = this.state === 'FEEDING' ;
          for (let item of result) {
            if (!awaitingFinish) {
              processInState(item);
              awaitingFinish = (this.state === 'FEEDING');
            } else {
              processInState(item);
              if (this.state === 'SEARCHING') {

              }
            }
          }
          

          let closedIndex = searchFindings.value.index;

          let scanResponse: Signal<Range.ReadOutput[], number> = {
            done: false,
            value: {
              index: closedIndex,
              data: this.applyLabels(toReturn.map(i => i))
            }
          }

          for (let item of result) {
            if (Event.describes(item)) {
              let event = item as Event;
              newSubsearchCompletionIndex = event.position;
              break;
            }
          }

          this.currentCompletions.set(subsearchId, scanResponse);
          // newSubsearchCompletionIndex = result.start;
        } else {
          newSubsearchCompletionIndex = searchFindings.value.index;
        }

        if (newSubsearchCompletionIndex !== lastCompletionIndex && this.state !== 'FEEDING') {
          attempted = false;
          this.scannerNamesByLastProcessedIndex.get(lastCompletionIndex).pop();
          
          if (this.scannerNamesByLastProcessedIndex.get(lastCompletionIndex).length === 0) {
            this.closedIndex = this.nextNumbers.get(lastCompletionIndex);
            this.scannerNamesByLastProcessedIndex.delete(lastCompletionIndex);
            let popped = this.allScannerLastProcessedIndexes.pop();
            this.evacUpto(popped);
          }

          if (!this.scannerNamesByLastProcessedIndex.has(newSubsearchCompletionIndex)) {
            this.allScannerLastProcessedIndexes.push(newSubsearchCompletionIndex);
          }
          this.scannerNamesByLastProcessedIndex.set(newSubsearchCompletionIndex, subsearchId);
        }
      }

      if (this.currentCompletions.has(subsearchId)) {
        let completed = this.currentCompletions.get(subsearchId) as Signal<Range.ReadOutput[], number>;
        this.currentCompletions.delete(subsearchId);
        this.closedIndex = completed.value.index ;
        return completed;
      }
    }
    
    return {
      done: this.completed,
      value: { index: this.closedIndex }
    }
  }

  private evacUpto(index: number) {
    if (this.prevNumbers.has(index)) this.prevNumbers.delete(index);
    if (this.nextNumbers.has(index)) this.nextNumbers.delete(index);
    if (this.data.has(index)) this.data.delete(index);
  }

  private setTokenIndexMappings(token) {
    if (this.lastObserved !==  token.index) {
      this.nextNumbers.set(this.lastObserved, token.index);
      this.prevNumbers.set(token.index, this.lastObserved);
      this.lastObserved = token.index;
    }
    this.data.set(token.index, token);
  }

  private close() {
    this.closedIndex = this.lastObserved;
    this.terminal = { done: true, value: { index: this.closedIndex } };
    this.completed = true;
    return this.terminal;
  }

  static factory(crawlerFactories: ScannerFactory<string, Range.ReadOutput[]>[], id?: string) {
    if (id === undefined || id === null) {
      id = crawlerFactories.map(factory => factory.id).join('||=')
    }
    return new AbstractScannerFactory<string, Range.ReadOutput[]>(id, 'race', (repository: Repository) => {
      let copy = crawlerFactories.map(i => i);
      let crawlers: Scanner<string, Range.ReadOutput[]>[] = copy.map(crawlerFactory => crawlerFactory(repository));
      let search: Scanner<string, Range.ReadOutput[]> = new Race(crawlers, id);
      return search;
    }) as ScannerFactory<string, Range.ReadOutput[]>
  }
}