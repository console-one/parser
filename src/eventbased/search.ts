import { Progress, Scanner, ScannerFactory, ScannerOptions } from './scanner.js';
import { State, StateBuilder } from './build.js';
import { EventQueue } from './eventqueue.js';
import { Event } from '../event.js';
import { Interval } from '../interval.js';
import { Stack } from '../vendor/generics/stack.js';
import { Logs } from '../vendor/generics/log.js';
import { Queue } from '../vendor/generics/queue.js';
import { IncrementalSink } from '../incremental.js';

/**
 * Events whose names are branch-scanner synthetic — Label emits
 * `label:<key>` Starts, Where wraps its child. Branch events carry
 * metadata for merging into a state's Start event and must not be
 * consumed by the interval builder.
 */
function isBranchEvent(event: Event): boolean {
  return typeof event.name === 'string' &&
    (event.name.startsWith('label:') || event.name.startsWith('where:'));
}

/**
 * Event-native pushdown search. Drives state transitions against a
 * watermarked EventQueue: child lookahead scanners race to recognise the
 * next transition, the winner's operations (PUSH/POP) are applied, and
 * the input reader is reindexed according to the winner's bound
 * (FROM rewinds, AFTER advances past the matched interval).
 *
 * Branch scanners associated with each state observe the state's own
 * output window (via a retained watermark on the output queue) and emit
 * metadata-bearing Start events that are merged into the state's opening
 * Start event before it is evicted.
 */
export class Search implements Scanner {

  public id: string;

  /** Buffer of inputs into this search. */
  private input: EventQueue;
  /** Buffer of outputs from this search. Events emitted here may be
   *  rewritten by branches before they evict past the frontmost watermark. */
  private output: EventQueue;

  /** Generator producing input events for the current active state. */
  private head: Generator<{ event: Event, index: number, blocked: boolean }>;
  /** Events evicted from the output buffer; ready to be returned by `shift`. */
  private evicted: Queue<Event>;

  public lastclosed: number;
  /** Closed index of the current lookahead. */
  private lookaheadClosed: number;
  private states: Stack<State>;
  /** Buffer of lookahead results awaiting resolution. */
  private buffer: Queue<Progress>;

  private builder: Interval.Builder;
  private started: boolean;
  /** Toggled when the head's index is changed on state transition;
   *  forces the outer shift() loop to re-enter rather than returning. */
  private reset: boolean;

  public logger: Logs;

  constructor(
    private initial: string,
    private root: StateBuilder,
    options: ScannerOptions = {},
    private sink?: IncrementalSink
  ) {
    this.id = options.id ?? `search:${initial}`;

    this.input = new EventQueue({
      id: `search:${initial}`,
      start: options.start ?? 0
    });
    this.output = new EventQueue({
      id: `[branches]search:${initial}`,
      start: options.start ?? 0,
      onEvict: (event) => this.evicted.push(event)
    });
    this.head = this.input.reader();
    this.evicted = new Queue();

    this.lastclosed = -1;
    this.states = new Stack();
    const watermark = (this.root.branchBuilders.length > 0) ?
      this.output.addWatermark() : undefined;
    this.states.push(this.root.build(watermark, { start: options.start }));
    this.buffer = new Queue();

    this.builder = Interval.builder(Event.start(initial, -1));
    this.started = false;
    this.reset = false;

    this.logger = new Logs(`search:${initial}`);
  }

  get complete(): boolean {
    return this.input.completedRead;
  }

  get lastreceived(): number {
    return this.input.maxConsumedSmallIndex;
  }

  reindex(newIndex: number): void {
    if (this.input.positions[0] !== undefined) this.input.reindexWatermark(0, newIndex);
  }

  private get state(): State {
    if (this.states.length < 1) throw new Error('No states active in the search!');
    return this.states.peak();
  }

  /**
   * Apply a lookahead-race result: push/pop states, advance input reader
   * according to the winner's FROM/AFTER bound, run branch scanners over
   * the popped state's output window to fold metadata into its Start.
   */
  private transition(last: Progress): void {
    const winner = last.values[0].name;
    const transition = this.state.transitions.get(winner);
    const position = transition.lookahead.bound === 'FROM' ?
      last.values[0].position : last.values[last.values.length - 1].position;

    const changes: ([Event.Start, StateBuilder] | [Event.End])[] = [];
    const pushes: StateBuilder[] = [];

    transition.operations.forEach(operation => {
      switch (operation.type) {
        case 'PUSH': {
          const dest = String(operation.args[0]);
          const components = dest.split('.');

          let root: StateBuilder;
          let builder: StateBuilder;
          let found = false;
          let done = false;

          while (!done) {
            if (pushes.length === 0) {
              if (root === undefined) root = this.state.builder;
              else root = root.parent;
              if (root === undefined) { done = false; break; }
            } else {
              root = pushes[pushes.length - 1];
            }
            builder = root;

            let valid = true;
            for (const component of components) {
              if (builder.children.has(component)) {
                builder = builder.children.get(component);
              } else { valid = false; break; }
            }

            if (valid) { found = true; break; }
          }
          if (!found) throw new Error(`Cannot transition to state ${dest}!`);
          pushes.push(builder);
          changes.push([ Event.start(builder.name, position), builder ]);
          break;
        }
        case 'POP': {
          const count = Number(operation.args[0]);
          for (let i = 1; i <= count; i++) {
            changes.push([ Event.end(this.states.impl[this.states.impl.length - i].name, position) ]);
          }
          break;
        }
      }
    });

    const result: Event[] = [];
    if (!this.started) {
      this.started = true;
      result.push(Event.start(this.initial, -1));
    }

    // Pull all input events up through the closed index of the active
    // lookahead, so they appear in the output stream before the state
    // transition events.
    const watermark = this.input.addWatermark(this.lastclosed + 1);
    if (this.lookaheadClosed === undefined)
      this.lookaheadClosed = this.buffer.peak().closed - 1;
    const reader = this.input.reader(watermark, this.lookaheadClosed);
    for (const iterated of reader) {
      result.push(iterated.event);
    }
    this.input.removeWatermark(watermark);

    switch (transition.lookahead.bound) {
      case 'FROM':
        this.logger.write('PROCESSING FROM LOOKAHEAD');
        this.input.reindexWatermark(0, this.lookaheadClosed + 1);
        this.head = this.input.reader(0);
        this.lastclosed = Math.max(this.lastclosed, this.lookaheadClosed);
        this.buffer.clear();
        this.reset = true;
        break;
      case 'AFTER':
        this.logger.write('PROCESSING AFTER LOOKAHEAD');
        while (this.buffer.length > 0) {
          result.push(...this.buffer.pull().values);
        }

        this.input.reindexWatermark(0, last.closed + 1);
        this.head = this.input.reader(0);

        if (last.closed + 1 <= this.lastreceived) this.reset = true;
        this.lastclosed = Math.max(this.lastclosed, last.closed);
        break;
    }
    this.lookaheadClosed = this.lastclosed;

    result.forEach(event => this.output.push(event));
    changes.forEach(change => {
      this.output.push(change[0]);
      if (change[0] instanceof Event.Start) {
        const builder = change[1];
        const stateWatermark = builder.branchBuilders.length > 0 ?
          this.output.addWatermark(this.output.maxSmallIndex) : undefined;

        this.states.push(builder.build(stateWatermark, { start: this.lastclosed + 1 }));
      } else {
        const last = this.states.pop();
        this.processBranches(last);

        if (this.states.length > 0) {
          const rebuilder = this.state.builder;
          const reader = this.states.pop().reader;
          this.states.push(rebuilder.build(reader, { start: this.lastclosed + 1 }));
        }
      }
      this.logger.write('NEW STATE:', (this.states.length > 0) ? this.state.name : null);
    });

    this.output.dequeue();
  }

  /**
   * Process branch scanners for a popped state: read the state's own
   * output window, feed each event to the state's branch scanner, and
   * merge any metadata the branch emits onto the state's Start event.
   *
   * This is the rewrite of the old inline branch-processing block. Key
   * changes from the original: do not require the first branch result
   * to be a Start (Race may emit Starts embedded later in its output),
   * and merge metadata from *every* Start the branch emits rather than
   * only the first.
   */
  private processBranches(state: State): void {
    if (state.reader === undefined) return;

    const reader = this.output.reader(state.reader, this.output.maxSmallIndex);
    let stateStart: Event.Start | undefined;

    for (const { event } of reader) {
      if (stateStart === undefined && event instanceof Event.Start) {
        stateStart = event;
      }
      const result = state.branches.shift(event);
      if (result.values === undefined || result.values.length === 0) continue;

      for (const emitted of result.values) {
        if (emitted instanceof Event.Start && emitted.metadata && stateStart !== undefined) {
          for (const key of Object.keys(emitted.metadata)) {
            stateStart.metadata[key] = emitted.metadata[key];
          }
        }
      }
    }

    this.output.removeWatermark(state.reader);
  }

  /**
   * Drain the `evicted` queue into a Progress for return; meanwhile feed
   * non-branch events into the interval builder for AST construction.
   */
  private computeOutputProgress(): Progress {
    const returnValue: Progress = {
      closed: this.lastclosed,
      done: this.complete
    };

    if (this.evicted.length > 0) {
      returnValue.values = [];
      while (this.evicted.length > 0) {
        const event = this.evicted.pull();
        this.logger.write('EMITTING:', event);

        returnValue.values.push(event);
        if (isBranchEvent(event)) continue;

        this.emit(event);

        if ((event.name === this.initial && event.kind === 'start') || this.builder.done) continue;

        try {
          this.builder.consume(event);
        } catch (error) {
          this.logger.write('STACK:', this.states.impl.map(state => state.name).join(', '));
          throw error;
        }
      }
    }
    return returnValue;
  }

  private emit(event: Event): void {
    if (this.sink === undefined) return;
    if (event instanceof Event.Token) {
      this.sink.resolve({ kind: 'token', data: event.data, position: event.position });
    } else if (event instanceof Event.Start) {
      this.sink.resolve({
        kind: 'start',
        name: event.name,
        position: event.position,
        metadata: event.metadata
      });
    } else if (event instanceof Event.End) {
      this.sink.resolve({ kind: 'end', name: event.name, position: event.position });
    }
  }

  shift(curEvent: Event): Progress {

    this.input.push(curEvent);
    this.logger.write('RECEIVED:', curEvent);
    let finished: boolean;
    do {
      if (this.states.length === 0) {
        this.lastclosed = this.input.maxSmallIndex;
        if (this.input.positions[0] !== undefined) this.input.removeWatermark(0);
        this.input.dequeue();

        while (this.states.length > 0) {
          const end = Event.end(this.states.pop().name, this.lastreceived + 1);
          this.evicted.push(end);
        }
        break;
      }

      let iterated: IteratorResult<{ event: Event, blocked: boolean }>;
      try {
        iterated = this.head.next();
      } catch (error) {
        this.logger.write('Search.shift() FAILED');
        this.logger.write('SEARCH QUEUE:', this.output);
        throw error;
      }

      if (iterated.done) {
        this.lastclosed = this.input.maxSmallIndex;
        if (this.input.positions[0] !== undefined) this.input.removeWatermark(0);
        this.input.dequeue();

        while (this.states.length > 0) {
          const end = Event.end(this.states.pop().name, this.lastreceived + 1);
          this.evicted.push(end);
        }
      } else {
        const event = iterated.value.event;
        const result = this.state.lookahead.shift(event);
        if (result.values !== undefined && result.values.length > 0) {
          this.logger.write('LOOKAHEAD RESULT:', result);

          const winner = (this.buffer.length === 0) ?
            result.values[0].name : this.buffer.peak().values[0].name;
          const state = this.state.transitions.get(winner);
          if (state === undefined) {
            this.logger.write('INVALID LOOKAHEAD RACE WINNER:', winner);
            this.logger.write(this.state);
            throw new Error('Invalid lookahead race winner!');
          }
          const after = (state.lookahead.bound === 'AFTER');
          this.buffer.push(result);

          if (after) {
            result.values.forEach(value => {
              if (this.buffer.peak().values[0].name === value.name && value.kind === 'end') {
                this.transition(result);
              }
            });
          } else {
            this.transition(result);
          }
        } else {
          this.lookaheadClosed = result.closed;
        }
      }

      finished = iterated.done || iterated.value.blocked;
      if (this.reset) {
        finished = false;
        this.reset = false;
      }
    } while (!finished);

    return this.computeOutputProgress();
  }

  /**
   * The AST built so far. Forces any open states closed and consumes
   * their synthesised End events into the builder.
   */
  get interval(): Interval {
    while (this.states.length > 0) {
      const end = Event.end(this.states.pop().name, this.lastreceived + 1);
      this.builder.consume(end);
    }
    const result = this.builder.build();
    if (result instanceof Error) throw result;
    return result;
  }

  static factory(initial: string, root: StateBuilder, sink?: IncrementalSink): ScannerFactory {
    return {
      name: `search:${initial}`,
      terms: [],
      create: (options) => new Search(initial, root, options, sink)
    };
  }
}
