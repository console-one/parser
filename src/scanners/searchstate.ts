import { ListMultimap } from '@console-one/multimap';
import { UUID } from "../vendor/generics/uuid.js";
import { DataToken } from '../datatoken.js';
import { Event } from '../event.js';
import { Range } from '../range.js';
import { QueueItem } from '../vendor/generics/queue.js';
import { Aggregation, Aggregator } from './../aggregation.js';
import { Interval } from './../interval.js';
import { AbstractScannerFactory, Repository, Scanner, ScannerFactory } from './../scanner.js';
import { Race } from './race.js';
import { TransitionLookahead } from './searchbuilder.js';
import { Operation } from './searchop.js';
import { Queue } from '../vendor/generics/queue.js'
import { Link } from '../vendor/generics/link.js';

// The SearchStateBuilder class is responsible for constructing and managing the states of the parser.
// It provides a way to define transitions, aggregations, and substates, and to build the final state factory.
// This class plays a crucial role in defining the behavior of the parser and how it processes the input text.
export class SearchStateBuilder {
  // Parent state builder, used to define hierarchical relationships between states
  public _parent: SearchStateBuilder
  // Name of the state
  public name: string
  // Aggregations define how the state combines or processes its children or tokens
  public aggregations: Map<string, Aggregator<any, any>>
  // Transition map defines the transitions from this state to other states
  public transitionMap: ListMultimap<string, Operation<any>>
  // Transition bounds specify whether transitions are triggered from or after specific symbols or patterns
  public transitionBounds: Map<string, 'FROM' | 'AFTER'>
  // Subsearches are specialized search states within this state
  public subsearches: any[]
  // Substates are child states of this state
  public substates: Map<string, SearchStateBuilder>
  // Start transitions define how this state can be entered
  public starts: TransitionLookahead[]
  // Queues to manage the start and end events for this state
  public startEvents: Queue<Event>
  public endEvents: Queue<Event>
  public states: Map<string, SearchStateBuilder>

  // Constructor initializes the state builder with a name and optional parent state
  constructor(name: string, parent?: SearchStateBuilder) {
    this.name = name;
    this.aggregations = new Map<string, Aggregator<any, any>>();
    this.transitionMap = new ListMultimap<string, Operation<any>>();
    this.transitionBounds = new Map<string, 'FROM' | 'AFTER'>();
    this.starts = [];
    this.subsearches = [];
    this.substates = new Map<string, SearchStateBuilder>();

    if (parent === undefined) this.states = new Map<string, SearchStateBuilder>();
    else {
      this.parent = parent;
      this.states = this.parent.states;
    }
    this.states.set(this.getContextualizedName(), this);
  }

  // Getter and setter for the parent state builder
  get parent() {
    return this._parent;
  }

  set parent(parent: SearchStateBuilder) {
    this._parent = parent;
    this._parent.substates.set(this.name, this);
  }

  // Returns the fully qualified name of this state, including parent state names
  getContextualizedName() {
    if (this.parent !== undefined) return this.parent.getContextualizedName() + '.' + this.name;
    return this.name;
  }

  // Builds and returns the final state factory for this state
  build(): SearchStateFactory {
    let state = new SearchStateFactory(
      this.getContextualizedName(),
      this.aggregations,

      new AbstractScannerFactory('search-for:' + this.getContextualizedName(), 'search', (repo) => Race.factory(this.subsearches, this.getContextualizedName())(repo)) as ScannerFactory<string, Range.ReadOutput[]>,
      this.transitionMap,
      this.transitionBounds
    )
    return state;
  }
}

// The SearchStateFactory class is responsible for creating instances of SearchState.
// It encapsulates the logic for building aggregations and creating the state itself.
export class SearchStateFactory {
  // Constructor initializes the state factory with necessary components
  constructor(
    public id: string,
    public aggregators: Map<string, Aggregator<any, any>>,
    public lookaheadFactory: ScannerFactory<string, Range.ReadOutput[]>,
    public transitionMap: ListMultimap<string, Operation<any>>,
    public transitionBounds: Map<string, 'FROM' | 'AFTER'>) {
  }

  // Builds aggregations based on the start event
  buildAggregations(start: Event.Start) {
    let aggregations: { [key: string]: Aggregation<any, any> } = {};
    for (let aggregatorID of this.aggregators.keys()) {
      let aggregator: Aggregator<any, any> = this.aggregators.get(aggregatorID);
      let result = aggregator.apply(start);
      if (result !== undefined) aggregations[aggregatorID] = result;
    }

    return aggregations;

  }

  // Creates a new SearchState instance
  create(start: Event.Start, repository: Repository, currentState?: SearchState) {
    if (!(start instanceof Event.Start)) throw new Error(``);

    return new SearchState(
      this.id,
      start,
      this.buildAggregations(start),
      this.lookaheadFactory(repository),
      this.transitionMap,
      this.transitionBounds,
      this,
      currentState
    )
  }
}

// The SearchEvent class represents an event within the parsing process.
// It provides mechanisms to control the propagation of the event and to manage cancellations.
export class SearchEvent {

  cancelledList: Set<string>
  cancelNext: boolean

  constructor(public value: Range) {
    this.cancelledList = new Set<string>();
  }

  // Prepares the event for processing
  beforeProcessing() { this.cancelNext = false; }

  // Stops the propagation of the event
  stopPropogation() { this.cancelNext = true; }

  // Marks the event as processed with the given name
  justProcessed(name: string) {
    if (this.cancelNext) this.cancelledList.add(name);
  }
}

// The SearchState class represents a state within the parsing process.
// It manages the state's properties, children, and behavior during the parsing.
export class SearchState {

  lastConsumed: QueueItem<DataToken> | undefined
  parent: SearchState | undefined
  uuid: UUID
  children: Map<string, SearchState>
  states: any
  interval: Interval
  nestings: number

  // public link: Link<Publisher>
  // public childrenPublisher: Link<Publisher>

  // Constructor initializes the state with necessary components
  constructor(
    public id: string,
    public start: Event.Start,
    public aggregations: { [key: string]: Aggregation<any, any> },
    public lookahead: Scanner<string, Range.ReadOutput[]>,
    public transitionMap: ListMultimap<string, Operation<any>>,
    public transitionBounds: Map<string, 'FROM' | 'AFTER'>,
    public type: SearchStateFactory,
    parent?: SearchState
  ) {
    // this.childrenPublisher = new Link<Publisher>();
    // this.link = new Link<Publisher>();

    // this.setPublisher = this.setPublisher.bind(this)
    // this.onPublisher = this.onPublisher.bind(this);

    if (parent !== undefined) {
      this.parent = parent;
      this.states = this.parent.states;
      // this.onPublisher(this.childrenPublisher.setReceiver)
      //  this.parent.childrenPublisher.onReceiver(this.setPublisher)
    }
  }

  // onPublisher(fn: (publisher: Publisher) => void) {
  //   this.link.onReceiver(fn);
  // }

  // setPublisher(publisher: Publisher) {
  //   this.link.setReceiver(publisher);
  // }

  // Applies the event to the state, updating aggregations and propagating to parent if needed
  apply(event: SearchEvent) {
    if (
      event.value.startEvent.kind === this.start.kind &&
      event.value.startEvent.name === this.start.name &&
      event.value.startEvent.position === this.start.position
    ) {
      this.close(event);
    } else {
      for (let prop of Object.keys(this.aggregations)) {
        let aggregation = this.aggregations[prop];
        if (!event.cancelledList.has(aggregation.type.type)) {
          event.beforeProcessing();
          aggregation.state = aggregation.type.reduce(aggregation.state, event, this.states);
          event.justProcessed(aggregation.type.type);
        }
      }
    }
    if (this.parent !== undefined) this.parent.apply(event);
  }

  // Closes the state, finalizing aggregations
  close(event: SearchEvent) {
    for (let prop of Object.keys(this.aggregations)) {
      let aggregation = this.aggregations[prop];
      if (!event.cancelledList.has(aggregation.type.type)) {
        let output;
        event.beforeProcessing();
        if (aggregation.type.cancel !== undefined) {
          output = aggregation.type.close(aggregation.state, this.states, event);
          let predicate = aggregation.type.cancel(output);
          if (!predicate) event.value.metadata[prop] = output;
        } else {
          event.value.metadata[prop] = aggregation.type.close(aggregation.state, this.states, event);
        }
        event.justProcessed(aggregation.type.type);
      }
    }
  }
}
