import { Aggregator } from './aggregation.js';
import { AbstractScannerFactory, Repository } from "./scanner.js";
import { Any } from './scanners/any.js';
import { Match } from './scanners/match.js';
import { Not } from './scanners/not.js';
import { Search } from './scanners/search.js';
import {
  AggregateStateFactory, DefineStateFactory, StartStateFactory, StateFactory,
  InheritedStateFactory, TokenStateFactory, TransitionLookahead, TransitionStateFactory
} from './scanners/searchbuilder.js';
import { SearchEvent } from './scanners/searchstate.js'
import { Operation } from './scanners/searchop.js';
import { Event } from './event.js'
import { IncrementalSink } from './incremental.js';

/**
 * Creates a transition that starts from a specific symbol or pattern.
 *
 * @param sym - An `AbstractScannerFactory` or a `string` representing the pattern.
 * @returns A new `TransitionLookahead` object initialized with a `FROM` boundary condition.
 *
 * @example
 * ```typescript
 * const fromGreen = from('🟢') // or from(match('🟢'))
 * parse(fromGreen, "🔵🔵🟢🔵🔵🟢🔵🔵🔵"),
 * fromGreen:       "⚪⚪⚫⚫⚫⚫⚫⚫⚫"
 * ```
 */
export const from = (sym: AbstractScannerFactory<any, any> | string) => {
  let operation: AbstractScannerFactory<any, any> = (typeof sym === 'string') ? match(sym) : sym;
  operation.configurations.push((scanner) => {
    scanner.configurations = scanner.configurations ?? {};
    scanner.configurations.quickClose = true;
    return scanner;
  })
  return new TransitionLookahead([{ bound: 'FROM', scannerFactory: operation, labels: [] }]);
}

/**
 * Creates a transition that starts after a specific symbol or pattern.
 *
 * @param sym - An `AbstractScannerFactory` or a `string` representing the pattern.
 * @returns A new `TransitionLookahead` object initialized with an `AFTER` boundary condition.
 *
 * @example
 * ```typescript
 * const afterGreen = after('🟢') // or after(match('🟢'))
 * parse(afterGreen, "🔵🔵🟢🔵🔵🟢🔵🔵🔵"),
 * afterGreen:       "⚪⚪⚪⚫⚫⚫⚫⚫⚫"
 * ```
 */
export const after = (sym: AbstractScannerFactory<any, any> | string) => {
  let operation: AbstractScannerFactory<any, any> = (typeof sym === 'string') ? match(sym) : sym;
  return new TransitionLookahead([{ bound: 'AFTER', scannerFactory: operation, labels: [] }]);
}

/**
 * Creates a transition that ends its state after a specific symbol or pattern.
 *
 * @param sym - An `AbstractScannerFactory` or a `string` representing the pattern.
 * @returns A new `TransitionStateFactory` object initialized with an `AFTER` boundary condition.
 *
 * @example
 * ```typescript
 * const uptoGreen = upto('🟢') // or upto(match('🟢'))
 * parse(uptoGreen, "🔵🔵🔵🔵🟢🔵🔵🔵"),
 * afterGreen:      "⚫⚫⚫⚫⚫⚪⚪⚪⚪"
 * ```
 */
export const upto = (sym: AbstractScannerFactory<any, any> | string): TransitionStateFactory => {
  let operation: AbstractScannerFactory<any, any> = (typeof sym === 'string') ? match(sym) : sym;
  let uptoLookeahead = new TransitionLookahead([{ bound: 'AFTER', scannerFactory: operation, labels: [] }]);
  return uptoLookeahead.terminate();
}

/**
 * Creates a transition that ends its state before a specific symbol or pattern.
 *
 * @param sym - An `AbstractScannerFactory` or a `string` representing the pattern.
 * @returns A TransitionStateFactory with a 'FROM' boundary condition and 'TERMINATE' action. 
 *
 * @example
 * ```typescript
 * const beforeGreen = before('🟢') // or before(match('🟢'))
 * parse(beforeGreenn, "🔵🔵🔵🔵🟢🔵🔵🔵"),
 * beforeGreen:        "⚫⚫⚫⚫⚪⚪⚪⚪"
 * ```
 */
export const before = (sym: AbstractScannerFactory<any, any> | string) => {
  let operation: AbstractScannerFactory<any, any> = (typeof sym === 'string') ? match(sym) : sym;
  let beforeLookeahead = new TransitionLookahead([{ bound: 'FROM', scannerFactory: operation, labels: [] }]);
  return beforeLookeahead.terminate();
}

/**
 * @deprecate Looking to remove in leiu of match(statefactory)
 * @param transition - The name of same cached state you want to match
 * @returns A new `TokenStateFactory` object.
 *
 * @example
 * ```typescript
 * const greenToRed = define('|🟢-|🔴', before('🔴'), start(from('🟢')));
 * const greenToRedBetweenBlue = define('greenToRedBetweenBlue', 
 *  token('|🟢-|🔴')
 *  upto('🔵'),
 *  start(after('🔵')),
 *  include(greenToRed)
 * );
 * //...
 * parse(greenToRedBetweenBlue,`🟢🔵🔴🟢🔵🔴🔵🟢🔴`)
 * betweenBlue:                 ⚪⚪⚫⚫⚫⚫⚪⚪⚪
 *     greenToRed:              ⚪⚪⚪⚪⚫⚪⚪⚪⚪    
 * ```
 */
export const token = (name: string): TokenStateFactory => {
  return new TokenStateFactory(name);
}

/**
 * Initializes the start state for your parser or state machine.
 *
 * @param transition - A `TransitionLookahead` object to define the initial state.
 * @returns A new `StartStateFactory` object.
 *
 * @example
 * ```typescript
 * const greenToRed = define('|🟢-|🔴', before('🔴'), start(from('🟢')));
 * const greenToRedBetweenBlue = define('greenToRedBetweenBlue', 
 *  token('|🟢-|🔴')
 *  upto('🔵'),
 *  start(after('🔵')),
 *  include(greenToRed)
 * );
 * //...
 * parse(greenToRedBetweenBlue,`🟢🔵🔴🟢🔵🔴🔵🟢🔴`)
 * betweenBlue:                 ⚪⚪⚫⚫⚫⚫⚪⚪⚪
 *     greenToRed:              ⚪⚪⚪⚪⚫⚪⚪⚪⚪    
 * ```
 */
export const start = (transition: TransitionLookahead) => {
  return new StartStateFactory(transition);
}

/**
 * Matches any of the characters from the given pattern or array of patterns.
 *
 * @param pattern - A `string` or an array of `string` patterns to match.
 * @returns A new factory instance configured with the `ANY` condition.
 *
 * @example
 * ```typescript
 * const blueAndRed = any(['🔴', '🔵']); // OR any('🔴🔵')
 * //...
 * parse(blueAndRed,`🟢🔵🔴🟢🔵🔴🔵🟢🔴`)
 * blueAndRed:       ⚪⚫⚫⚪⚫⚫⚫⚪⚫
 * ```
 */
export const any = (pattern: string | string[]) => {
  return Any.factory(pattern)
}

/**
 * Matches any of the characters from the given pattern or array of patterns.
 *
 * @param pattern - A `string` or an array of `string` patterns to match.
 * @returns A new factory instance configured with the `ANY` condition.
 *
 * @example
 * ```typescript
 * const notBlueOrRed = not('🔴🔵');
 * // OR
 * const notBlueOrRed = not(['🔴', '🔵']);
 * //...
 * parse(notBlueOrRed,`🟢🔵🔴🟢🔵🔴🔵🟢🔴`)
 * blueAndRed:        `⚫⚪⚪⚫⚪⚪⚪⚫⚪`
 * ```
 */
export const not = (pattern: string | string[]) => {
  return Not.factory(pattern)
}
/**
 * Matches a specific pattern in the text.
 *
 * @param pattern - A `string` pattern that should be matched exactly.
 * @returns A new factory instance configured to match the given pattern.
 *
 * @example
 * ```typescript
 * const matchPattern = match('🔵🔴🔵');
 * //...
 * parse(matchPattern,`🟢🔵🔴🟢🔵🔴🔵🟢🔴`)
 * matchPattern:      `⚪⚪⚪⚪⚫⚫⚫⚪⚪`
 * ```
 */
export const match = (pattern: string) => {
  return Match.factory(pattern);
}

/**
 * Defines a new named state with associated transitions which can be used to build a parser.
 *
 * @param name - A `string` representing the name of the state.
 * @param transitions - A spread array of `StateFactory` objects representing the state's transitions.
 * @returns A new `DefineStateFactory` object.
 *
 * @example
 * ```typescript
 * const adjacentBlues = define('firstBluesAfterRed', start(from('🔵')), after(any('🔵')));
 * const blueOrNotGreen = define('blueOrNotGreen', 
 *  not('🟢'), 
 *  token('firstBluesAfterRed'), 
 *  include(adjacentBlues)
 * );
 * //...
 * parse(blueOrNotGreen,`🔴🟢🔴🔵🔵🔵🟢🔴🟢`)
 * blueOrNotGreen:      `⚫⚪⚫⚫⚫⚫⚪⚫⚪`
 * ```
 */
export const define = (name: string, ...transitions: StateFactory[]) => {
  return new DefineStateFactory(name, ...transitions);
}

// Pushes a new state onto the parser's state stack
export const push = (name: string, ...variables: [string, string?][]) => {
  if (typeof push === 'object') {
    return new Operation<'PUSH'>('PUSH', [name, variables]);
  }

}

// Pops a state from the parser's state stack
export const pop = (num?: number | string | string[]) => {
  let args;
  if (num !== undefined && typeof num === 'number') {
    args = [];
    if (num !== undefined) args.push(num);
    return new Operation<'POP'>('POP', args);
  } else if (num !== undefined && typeof num === 'string') {
    if (num !== undefined) args.push(num);
    return new Operation<'POP_TO'>('POP_TO', args);
  }

}

// Transitions to a named state
export const goto = (name: string, ...variables: [string, string?][]) => {
  return new Operation<'GOTO'>('GOTO', [name, variables]);
}

/**
 * Attaches a key-value label to a specific state or transition.
 *
 * @param key - A `string` representing the key for the label.
 * @param value - An optional `string` value for the label. Defaults to the value of `key`.
 * @returns A new aggregate unit with the applied label.
 *
 * @example
 * ```typescript
 * const labelExample = label('Type', 'Letter');
 * // OR
 * const labelExample = label('Type');
 * 
 * ```
 */
export const label = (key: string, value?: string) => {
  if (value === undefined) value = key;
  return aggregate(key, Aggregator.Label(value))
}

/**
 * Combines multiple states or transitions into a single aggregate unit.
 *
 * @param key - A `string` representing the key for the aggregate unit.
 * @param aggregator - An `Aggregator` object used to combine states or transitions.
 * @returns A new `AggregateStateFactory` object.
 *
 * @example
 * ```typescript
 * const aggregateExample = aggregate('group1', someAggregator);
 * ```
 */
export const aggregate = (key: string, aggregator: Aggregator<any, any>) => {
  return new AggregateStateFactory(key, aggregator);
}

/**
 * Creates a new state that inherits its behavior from another state.
 *
 * @param other - A `DefineStateFactory` object from which to inherit behavior.
 * @returns A new `InheritedStateFactory` object.
 */
export const inherit = (other: DefineStateFactory) => {
  return new InheritedStateFactory(other);
}

/**
 * Creates a specialized version of an existing state with additional transitions.
 *
 * @param other - A `DefineStateFactory` object from which to base the new state.
 * @param name - A `string` representing the name of the specialized state.
 * @param transitions - A spread array of `StateFactory` objects to add to the existing transitions.
 * @returns A new `DefineStateFactory` object.
 * ```
 */
export const substate = (other: DefineStateFactory, name: string, ...transitions: StateFactory[]) => {
  let states = other.transitions.concat(transitions);
  return define(name, ...states);
}


// Builds a search object representing the parser's state machine
export const build = (definedStates: DefineStateFactory, initialState: string, parseID: string, publisher?: IncrementalSink) => {

  let table = definedStates.build();
  if (publisher === undefined) {
    return new Search(initialState, new Repository(table), parseID);
  } else {
    return new Search(initialState, new Repository(table), parseID, publisher);
  }
}



// Defines complex state behavior based on a function
export const set = (name, cb) => {
  return aggregate(name, cb(name));
}

// Extracts a single value from a child state
export const asonly = (childname: string, extraction) => {
  return (key) => Aggregator.Only(key, childname, extraction)
}

// Extracts all values from a child state
export const asall = (childname: string, extraction) => {
  return (key) => Aggregator.All(key, childname, extraction)
}

// Triggers a function when a specific interval is closed
export const fromclose = (fn: (interval: SearchEvent, states?: any) => any) => {
  let options: any = {}
  options.initialize = () => undefined;
  options.reduce = () => undefined;
  return (name) => Aggregator.create(name, () => true, {
    close: (state, states, last) => fn(last, states)
  })
}

// Performs a reduction operation on the parser's state
export const asreduction = <State, Output>(
  initialize: (first: Event) => State,
  reduce: (state: State, next: SearchEvent, states: any) => State,
  close?: (state: State, states: any, last: any) => Output,
) => {
  let options: any = {}
  options.initialize = initialize;
  options.reduce = reduce;
  if (close !== undefined) options.close = close;
  return (name) => Aggregator.create(name, () => true, options)
}

// Performs a reduction operation on the parser's state with cancel option
export const ascancellablereduction = <State, Output>(
  initialize: (first: Event) => State,
  reduce: (state: State, next: SearchEvent, states: any) => State,
  cancel: (state: Output) => boolean,
  close?: (state: State, states: any, last: any) => Output
) => {
  let options: any = {}
  options.initialize = initialize;
  options.reduce = reduce;
  options.cancel = cancel;
  if (close !== undefined) options.close = close;
  return (name) => Aggregator.create(name, () => true, options)
}
