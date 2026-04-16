import { Closure } from './vendor/generics/closure.js';
import { Range } from './range.js';
import { SearchStateFactory } from './scanners/searchstate.js';
import { Signal } from './signal.js';

import { Logs } from './vendor/generics/log.js';

export interface Scanner<T, K> {
  id: string
  shift: (signal: Signal<T, number>) => Signal<K, number>
  complete(): boolean
  configurations?: any
  print(tabs?: number): string
}

type MapperOf<Input, Output> = { (input: Input): Output }

export type FactoryBuilder = {
  name: string
  buildFactory(repository: Repository, names?: Set<string>) : ScannerFactory<string, Range.ReadOutput[]>
}

export class Repository {

  map: Map<string, SearchStateFactory>
  logger: Logs

  constructor(preloaded?: Map<string, SearchStateFactory>) {
    this.map = new Map<string, SearchStateFactory>();
    if (preloaded !== undefined) {
      for (let key of preloaded.keys()) this.map.set(key, preloaded.get(key));
    }
  }
  
  log(...data: any[]) {
    if (this.logger) this.logger.write(...data);
    else console.log(...data);
  }
  
  set(id: string, searchState: SearchStateFactory) {
    this.map.set(id, searchState);
  }

  get(id: string, state?: SearchStateFactory) {
    if (state !== undefined) {
      let splits = state.id.split('.');
      do {
        let nextAttempt = splits.concat([id]).join('.'); 
        if (this.map.has(nextAttempt)) {
          return this.map.get(nextAttempt);
        }
        if (splits.length > 0) splits.pop();
      }  while (splits.length >= 0) ;
    } else {
      return this.map.get(id);
    }
  }

  load(id: string) : ScannerFactory<string, Range.ReadOutput[]> {
    return this.map.get(id).lookaheadFactory;
  }
}

export type Lookahead = string | AbstractScannerFactory<string, Range.ReadOutput[]>


export interface ScannerFactory<T, K> extends MapperOf<Repository, Scanner<T, K>> {
  id: string
  type: string
  configurations: ((configs: Scanner<T, K>) => Scanner<T, K>)[]
  toJSON?(): any
}

export class AbstractScannerFactory<T, K> extends Closure {

  configurations: ((configs: Scanner<T, K>) => Scanner<T, K>)[]

  constructor(public id: string, public type: string, fnc: MapperOf<Repository, Scanner<T, K>>) {

    super((repo) => {
      let Scanner = fnc(repo);

      for (let configuration of this.configurations) {
        Scanner = configuration(Scanner);
      }
      return Scanner;
    });

    this.configurations = [];
  }

  static create<T, K>(id: string, type: string, fnc: MapperOf<Repository, Scanner<T, K>>) {
    let finderFactory = new AbstractScannerFactory<T, K>(id, type, fnc);
    return finderFactory as ScannerFactory<T, K>;
  }

  toJSON?() { return this.id;  }
}



