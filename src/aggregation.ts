

import { Event } from './event.js'
import { Range } from './range.js'
import { SearchEvent } from './scanners/searchstate.js'
        
export class Aggregation<State, Output> {
  constructor(
    public id: string,
    public state: State,
    public close: ((lastEvent: Event, states: any) => boolean),
    public type: Aggregator<State, Output>) {}
}

export type AggregationOptions<Event, State, Output> = {
  initialize?: (firstEvent: Event, states: any) => State,
  reduce?: (state: State, nextEvent: SearchEvent, states: any) => State,
  start?: (firstEvent: Event, states: any) => ((lastEvent: SearchEvent, states: any) => boolean) | undefined,
  getId?: (firstEvent: Event, states: any) => string,
  close?: (state: State, states: any, lastEvent?: SearchEvent) => Output,
}

const AggregationDefault = <State>(predicate: (Event: Event, states: any) => boolean) => {
  return {
    initialize: () => undefined,
    reduce: () => undefined,
    start: (Event: Event, states: any) => (predicate(Event, states)) ? (next: Event, states: any) => (next.kind === 'end' && next.name === Event.name) : undefined,
    getId: (Event: Event, states: any) => `${Event.name}:${Event.position}`,
    close: (state: State, states: any, lastEvent?: SearchEvent) => state
  }
}

const OptionalAggregationFunctions = ['cancel']

type Scan<Configuration, Item, State> = {
  initialize: (configuration: Configuration) => State,
  update: (state: State, item: Item) => State
}

export class Aggregator<State, Output> {

  constructor(
    public type: string,
    public getId: (firstEvent: Event, states: any) => string,
    public start: (firstEvent: Event, states: any) => ((lastEvent: Event, states: any) => boolean) | undefined,
    public initialize: (firstEvent: Event, states: any) => State,
    public reduce: (state: State, nextEvent: SearchEvent, states: any) => State,
    public close: (state: State,  states: any, lastEvent?: SearchEvent) => Output,
    public cancel?: (state: Output) => boolean,
  ) {
  }

  apply(firstEvent: Event): Aggregation<any, any> | undefined {
    let close = this.start(firstEvent, this);
    if (close !== undefined) {
      let id = this.getId(firstEvent, this);
      let state = this.initialize(firstEvent, this);
      return new Aggregation(id, state, close, this);
    }
    return undefined;
  }

  static create = <State, Output>(
    type: string, 
    appliesTo: (Event: Event, states: any) => boolean,
    options: AggregationOptions<Event, State, Output>) => {

    let defaults = AggregationDefault(appliesTo);

    let finalAggregations: any = {}; 
    let keys = Array.from(Object.keys(defaults)).concat(
      OptionalAggregationFunctions.filter(optionName => options[optionName] !== undefined)
    );
    for (let optionName of keys) {
      if (options[optionName] === undefined) finalAggregations[optionName] = defaults[optionName];
      else finalAggregations[optionName] =  options[optionName];
    }
    
    return new Aggregator<State, Output>(
      type,
      finalAggregations.getId,
      finalAggregations.start,
      finalAggregations.initialize,
      finalAggregations.reduce,
      finalAggregations.close,
      finalAggregations.cancel
    );
  }
}

export namespace Aggregator {
  
  export const Label = (name) => Aggregator.create(
    'label', 
    (event, states) => true,
    { close: (state, states) => name }
  )

  export const Only = <State>(name, aspects, extract: (next: SearchEvent) => State) => Aggregator.create<State, State>(`only:${name}:${aspects}`, () => true, {
      initialize: (event, states) => undefined,
      reduce: (state, next, states) => {
        if (next.value.name === aspects) {
          if (state === undefined) state = extract(next);
          else if (state !== undefined) throw new Error(`Two items found with the same name while only one is enforced!`)
        }
        return state;
      }
  })

  export const All = <Item>(name,  aspects, extract: (next: SearchEvent) => Item) => Aggregator.create<[Range, Item][], [Range, Item][]>(`all:${name}:${aspects}`, () => true, {
    initialize: (event, states) => ([]),
    reduce: (state, next, states) => {
      if (next.value.name === aspects) state.push([next.value, extract(next)])
      return state;
    }
  }) 
}

