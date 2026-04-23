import { Event } from '../event.js';

/**
 * Progress emitted by a scanner on each shift.
 *  - `closed`: input index through which this scanner has reached a
 *    decision. Drivers may advance watermarks up to and including this index.
 *  - `values`: events produced by this shift (absent/empty when the scanner
 *    only advanced its closed index without emitting output).
 *  - `done`: true once the scanner will produce no further output.
 */
export interface Progress {
  closed: number;
  done: boolean;
  values?: Event[];
}

/**
 * An event-native scanner. Input and output are both discrete `Event`s.
 * Drivers call `shift(event)` once per input event; each call returns the
 * scanner's updated Progress.
 *
 * Field names (`lastclosed`, `lastreceived`) intentionally match the
 * original event-based branch — so ported scanner implementations compile
 * unchanged against this interface.
 */
export interface Scanner {
  id: string;
  complete: boolean;
  lastclosed: number;
  lastreceived: number;
  shift(event: Event): Progress;
  reindex(newIndex: number): void;
}

export type ScannerOptions = {
  id?: string;
  start?: number;
};

export interface ScannerFactory {
  name: string;
  terms: unknown[];
  create(options?: ScannerOptions): Scanner;
}

/**
 * Predicate evaluated against a single event.
 */
export type EventPredicate = (event: Event) => boolean;

/**
 * Factory producing a predicate used to detect the start of a range match.
 */
export type StartEventPredicateFactory = () => EventPredicate;

/**
 * Factory producing a predicate used to detect the end of a range match,
 * parameterised by the start event that was matched.
 */
export type EndEventPredicateFactory = (event: Event) => EventPredicate;

/**
 * Descriptor for a range pattern — matches on a start/end event pair rather
 * than an atomic character.
 */
export class IntervalDescriptor {
  constructor(
    public name: string,
    public matchStart: StartEventPredicateFactory,
    public buildEnd: EndEventPredicateFactory
  ) {}
}

/**
 * The two kinds of pattern component a scanner recognises: a literal string
 * (ATOMIC) or an IntervalDescriptor (RANGE).
 */
export type NamedPatternTypes = {
  ATOMIC: string;
  RANGE: IntervalDescriptor;
};

export type PatternTypes = NamedPatternTypes[keyof NamedPatternTypes];

/**
 * Protocol type: the four ports of an interactive node.
 *  - `state`     — hidden internal state
 *  - `output`    — projection published to observers
 *  - `selection` — input pushed in by the driver
 *  - `terminal`  — lifecycle end marker
 */
export type Protocol = {
  state: unknown;
  output: unknown;
  selection: unknown;
  terminal: unknown;
};

/**
 * Generator encoding of a node. Authors write straight-line logic; each
 * `yield output` publishes a projection and resumes on the next selection.
 *
 * A Provider *authors* a node; composition between nodes is a separate
 * concern (for parsers: EventQueue with watermarks). This type names only
 * the node shape, not its wiring.
 */
export type Provider<P extends Protocol = Protocol> =
  Generator<P['output'], P['terminal'], P['selection']>;

/**
 * Parser-specialised protocol: a scanner yields `Progress` deltas and
 * receives `Event`s; terminal is a boolean done-flag.
 *
 * `output` is a delta (new values + closed index), not a full projection
 * of state — streams run too hot for full re-summarisation.
 */
export type ScannerProtocol<State = unknown> = {
  state: State;
  output: Progress;
  selection: Event;
  terminal: boolean;
};
