import { AbstractScannerFactory } from '../scanner.js'
import { Aggregator } from './../aggregation.js'
import { Operation } from './searchop.js'
import { SearchStateBuilder, SearchStateFactory } from './searchstate.js'
import { Queue } from '../vendor/generics/queue.js'
import { Match } from './match.js'
import { UUID } from '../vendor/generics/uuid.js'

export abstract class StateFactory {
  abstract apply(builder: SearchStateBuilder): SearchStateBuilder
  abstract stateFactoryType(): string
  abstract typeID(): string
}

export interface TableBuilder {
  build(): Map<string, SearchStateFactory>
}

export class AggregateStateFactory extends StateFactory {

  constructor(public key: string, public aggregation: Aggregator<any, any>) {
    super();
  }

  typeID(): string { return this.key };

  stateFactoryType(): string { return "aggregate"; }

  apply(stateBuilder: SearchStateBuilder) {
    stateBuilder.aggregations.set(this.key, this.aggregation);
    return stateBuilder;
  }
}

export class InheritedStateFactory extends StateFactory {

  constructor(public defineStateFactory: DefineStateFactory) {
    super();
  }

  typeID(): string { return this.defineStateFactory.name };

  stateFactoryType(): string { return "inherited"; }

  apply(stateBuilder: SearchStateBuilder) {
    for (let transition of this.defineStateFactory.transitions) stateBuilder = transition.apply(stateBuilder);
    return stateBuilder;
  }
}


export class DefineStateFactory extends StateFactory implements TableBuilder {

  public transitions: StateFactory[]
  public indexed: Map<string, Map<string, StateFactory>>
  public inherit: boolean
  public assignedname: string
  public name: string

  constructor(name: string, ...transitions: StateFactory[]) {
    super();
    this.name = name;
    this.assignedname = UUID.random();
    this.transitions = transitions;
    this.indexed = new Map<string, Map<string, StateFactory>>();
    for (let transition of this.transitions) {
      if (!this.indexed.has(transition.stateFactoryType())) this.indexed.set(transition.stateFactoryType(), new Map<string, StateFactory>());
      this.indexed.get(transition.stateFactoryType()).set(transition.typeID(), transition);
    }
    this.inherit = true 
  }

  access(typeDescriptions: { type: string, name?: string }): StateFactory[] {
    if (!this.indexed.has(typeDescriptions.type)) return [];
    let typeMap = this.indexed.get(typeDescriptions.type);
    if (typeDescriptions.name === undefined) return Array.from(typeMap.values());
    return typeMap.has(typeDescriptions.name) ? [typeMap.get(typeDescriptions.name)] : [];
  }

  substate(...names: string[]): DefineStateFactory {
    let node: DefineStateFactory = this;
    let namesIndex = 0; 
    while (node !== undefined && namesIndex < names.length) {
      let name = names[namesIndex];
      let result = node.access({ type: 'define', name: name }) as unknown as DefineStateFactory[];
      if (result.length < 1) return undefined;
      node = result[0];
      namesIndex += 1;
    }
    return node;
  }

  typeID(): string { return this.name };

  stateFactoryType(): string { return "define"; }

  apply(parentStateBuilder?: SearchStateBuilder) {

    let stateBuilder = this.inherit ? new SearchStateBuilder(this.name, parentStateBuilder) : new SearchStateBuilder(this.name);
    if (parentStateBuilder !== undefined) {
      parentStateBuilder.states.set(stateBuilder.name, stateBuilder);
      stateBuilder.states = parentStateBuilder.states;
    }

    for (let transition of this.transitions.filter(t => t.stateFactoryType() === "inherited")) stateBuilder = transition.apply(stateBuilder);
    for (let transition of this.transitions.filter(t => t.stateFactoryType() === "define")) stateBuilder = transition.apply(stateBuilder);
    for (let transition of this.transitions.filter(t => t.stateFactoryType() !== "define" && t.stateFactoryType() !== "inherited")) stateBuilder = transition.apply(stateBuilder);
    return (parentStateBuilder !== undefined) ? parentStateBuilder : stateBuilder;
  }

  load(substate: string) {
    let fullpath = this.name;
    let list = Queue.of(...substate.split('.'));
    let notmissed = true;
    let lastDefinedStates = [];
    let lastDefined: DefineStateFactory = this;
    
    while (list.length > 0 && notmissed) {
      notmissed = false;
      lastDefinedStates = [];
      for (let transition of lastDefined.transitions.filter(t => t instanceof DefineStateFactory)) {
        let definedState = (transition as unknown as DefineStateFactory);
        lastDefinedStates.push(definedState.name)
        if (definedState.name === list.peak()) {
          fullpath += '.' + list.shift();
          notmissed = true;
          lastDefined = definedState;
          break;
        }
      }
    }
    if (!notmissed) {
      // console.log(`Could not load substate for inheritance: ${substate}, missed in state definition of: ${fullpath}`);
      // console.log(`Defined states are: `, lastDefinedStates);
      throw new Error(`Error loading substate definition!`)
    }
    let selected = new DefineStateFactory(fullpath, ...lastDefined.transitions);
    selected.inherit = false;
    return selected;
  }

  build() {
    let stateBuilder = this.apply();
    let searchStates = new Map<string, SearchStateFactory>();
    for (let state of stateBuilder.states.keys()) {
      searchStates.set(state, stateBuilder.states.get(state).build());
    }
    return searchStates;
  }
}


export class TokenStateFactory extends StateFactory {

  constructor(public name: string) {
    super();
  }
  typeID(): string { return this.name; }

  stateFactoryType(): string { return "token"; }

  apply(stateBuilder: SearchStateBuilder) {

    if (stateBuilder.states.has(stateBuilder.getContextualizedName() + '.' + this.name)) {
      let toLaunch = stateBuilder.states.get(stateBuilder.getContextualizedName() + '.' + this.name);
      try {
        for (let tlookahead of toLaunch.starts) {
          let factory = new TransitionStateFactory(tlookahead.transitions, new Operation('PUSH', [stateBuilder.getContextualizedName() + '.' + this.name]));
          stateBuilder = factory.apply(stateBuilder);
        }
      } catch (err) {
        // console.log(JSON.stringify(Array.from(stateBuilder.states.keys()), null, 2))
        // console.log(this);
        throw err;
      }
    } else if (stateBuilder.states.has(this.name)) {
      let toLaunch = stateBuilder.states.get(this.name);
      for (let tlookahead of toLaunch.starts) {
        let factory = new TransitionStateFactory(tlookahead.transitions, new Operation('PUSH', [this.name]));
        stateBuilder = factory.apply(stateBuilder);
      }
    } else {
      // console.log(JSON.stringify(Array.from(stateBuilder.states.keys()), null, 2))
      // console.log(this);
      throw new Error(`Cannot apply token!`)
    }

    return stateBuilder;
  }
}

export class TransitionStateFactory extends StateFactory {

  public operations: Operation<any>[]
  constructor(
    public lookaheads: { bound: 'FROM' | 'AFTER', scannerFactory: AbstractScannerFactory<any, any>, labels: [string, Aggregator<any, any>][] }[],
    ...operations: Operation<any>[]
  ) {
    super();
    this.operations = operations;
  }
  
  typeID(): string {
    let accum = undefined;
    for (let lookahead of this.lookaheads) {
      let lookheadString = lookahead.bound + ':' + lookahead.scannerFactory.type + ':' + lookahead.scannerFactory.id; 
      accum = accum === undefined ? lookheadString : accum + ',' + lookheadString;
    }
    return accum;
  }

  stateFactoryType(): string { return "transition" }

  apply(builder: SearchStateBuilder) {
    let firstBuilder = builder;

    if (this.lookaheads.length > 1) {
      let currentID, nextID;

      for (let i = 0; i < this.lookaheads.length-1; i++) {
        currentID =  (currentID === undefined) ? this.lookaheads[i].scannerFactory.type + ':' + this.lookaheads[i].scannerFactory.id : currentID;
        nextID = this.lookaheads[i].bound + ':' + currentID;
        let operations = (i === 0) ? [new Operation('PUSH', [nextID])] : [new Operation('GOTO', [nextID])];
        operations.map(op => builder.transitionMap.set(currentID, op));
        builder.transitionBounds.set(currentID, this.lookaheads[i].bound);
        builder.subsearches.push(this.lookaheads[i].scannerFactory);
        let stateBuilder = new SearchStateBuilder(nextID,  builder);
        for (let aggregate of this.lookaheads[i+1].labels) stateBuilder.aggregations.set(aggregate[0], aggregate[1]);
        builder = stateBuilder;
      }
      
      let i = this.lookaheads.length-1;
      let id = this.lookaheads[i].scannerFactory.type + ':' + this.lookaheads[i].scannerFactory.id; 

      builder.transitionBounds.set(id, this.lookaheads[i].bound);
      builder.transitionMap.set(id, new Operation('POP', []));
      builder.transitionMap.setAll(id, this.operations)
      builder.subsearches.push(this.lookaheads[i].scannerFactory);

    } else {
      let id = this.lookaheads[0].scannerFactory.type + ':' + this.lookaheads[0].scannerFactory.id; 
      builder.transitionBounds.set(id, this.lookaheads[0].bound);
      builder.transitionMap.setAll(id, this.operations);
      builder.subsearches.push(this.lookaheads[0].scannerFactory);
    }
    return firstBuilder;
  }
}

export class StartStateFactory extends StateFactory {

  constructor(public transition: TransitionLookahead) {  super(); }

  typeID(): string { 
    let accum = undefined;
    for (let lookahead of this.transition.transitions) {
      let lookheadString = lookahead.bound + ':' + lookahead.scannerFactory.type + ':' + lookahead.scannerFactory.id; 
      accum = accum === undefined ? lookheadString : accum + ',' + lookheadString;
    }
    return accum;
  }

  stateFactoryType(): string { return "start"; }
  
  apply(builder: SearchStateBuilder) {
    builder.starts.push(this.transition);
    return builder;
  }
}

export class TransitionLookahead {

  constructor(public transitions: { 
      bound: 'FROM' | 'AFTER', 
      scannerFactory: AbstractScannerFactory<any, any>, 
      labels: [string, Aggregator<any, any>][] 
  }[]) { }

  label(key, val) {
    this.transitions[this.transitions.length-1].labels.push([key, val]);
    return this;
  }

  from(sym: AbstractScannerFactory<any, any> | string) {
    let operation: AbstractScannerFactory<any, any> = (typeof sym === 'string') ?  Match.factory(sym) : sym;
    operation.configurations.push((scanner) => {
      scanner.configurations = scanner.configurations ?? {};
      scanner.configurations.quickClose = true;
      //console.log("SET QUICK CLOSE CONFIGS ON: ", scanner.id)
      return scanner;
    })
    this.transitions.push({ bound: 'FROM', scannerFactory: operation, labels: [] });
    return this;
  }

  after(sym: AbstractScannerFactory<any, any> | string) {
    let operation: AbstractScannerFactory<any, any> = (typeof sym === 'string') ?  Match.factory(sym) : sym;
    this.transitions.push({ bound: 'FROM', scannerFactory: operation, labels: []});
    return this;
  }

  push(name: string) {
    return new TransitionStateFactory(this.transitions, new Operation('PUSH', [name]));
  }

  terminate(num?: number) {
    let op = (num !== undefined) ? new Operation('POP', [num]) : new Operation('POP', [])
    return new TransitionStateFactory(this.transitions, op);
  }

  goto(name: string) {
    return new TransitionStateFactory(this.transitions, new Operation('GOTO', [name]));
  }
}
