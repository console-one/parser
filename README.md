# @console-one/parser

A pushdown parser built from **runtime-composable transition tables**. Scanner primitives (KMP Match, character-class Any/Not, ordered-choice Race) feed a pushdown automaton driven by a grammar you declare in a fluent TypeScript DSL. Grammars compose dynamically — one encoding module registers its states into another encoding's table — which is the interesting part.

## What makes this interesting

Traditional parsers compile grammars at build time. Tree-sitter generates C from a JS grammar file. ANTLR generates Java from a `.g4`. Parser combinators (Parsec, nom, Chevrotain) compose at runtime but compose *functions*.

This one composes **table entries**. A host grammar (say, JSON) registers its own transitions, and an encoding module (say, a meta-language for embedded dependency references) adds additional transitions into the same table. The result is one pushdown automaton that parses a host language with embedded guest languages sharing the same parse stack.

That's unusual. Tree-sitter supports language injection, but each injected language is a separate grammar with its own stack. Racket reader macros are conceptually similar but only work for S-expression hosts.

See `src/grammar.ts` for the DSL (`define`, `from`, `after`, `match`, `any`, `not`, `push`, `goto`, `terminate`, …) and `src/smoke.ts` for worked examples.

## Install

```bash
npm install @console-one/parser @console-one/multimap heap-js uuid
```

## Quick start

```ts
import { build, define, after, from, match, not } from '@console-one/parser'
import { v4 as uuid } from 'uuid'

const grammar = define('doc',
  after(match('(')).push('body'),
  define('body',
    from(not(')')).goto('body'),
    after(match(')')).terminate()
  )
)

const search = build(grammar, 'doc', uuid())
for (const ch of 'x(hello)y') {
  search.shift({ done: false, value: { index: ..., data: ch } })
}
search.shift({ done: true, value: { index: ... } })

console.log(search.rootInterval)  // Interval tree
```

## Public surface

Exported from `@console-one/parser`:

**Grammar DSL** — `define`, `from`, `after`, `upto`, `before`, `token`, `start`, `any`, `not`, `match`, `push`, `pop`, `goto`, `label`, `aggregate`, `inherit`, `substate`, `build`, `set`, `asonly`, `asall`, `fromclose`, `asreduction`, `ascancellablereduction`

**Scanner primitives** — `Match` (KMP), `Any`, `Not`, `Race` (parallel ordered-choice), `Search` (the driving engine)

**Parse tree types** — `Interval`, `DataToken`, `Range`, `Position`, `Absolute`, `Relative`, `Signal`, `Event`

**Aggregation** — `Aggregator`, `Aggregation` (in-stream reductions on interval close)

**Streaming sink** — `IncrementalSink` (optional: implement `.resolve(msg)` to receive events as the parse progresses)

**Tree utilities** — `toTree`, `descendants`, `filter`, `IntervalBuilder`, `TokenBuilder`, `tokenstring`

## src/ layout

```
src/
├── index.ts                # Public surface
├── smoke.ts                # End-to-end smoke test (runs the real pipeline)
├── incremental.ts          # IncrementalSink — minimal streaming interface
├── grammar.ts              # Fluent DSL for declaring grammars
├── aggregation.ts          # Aggregator / Aggregation for in-stream reductions
├── scanner.ts              # Scanner<T,K> / Repository / AbstractScannerFactory
├── signal.ts               # Signal<DataType, SequenceType> (position-tagged stream values)
├── event.ts                # Event (START | END | TOKEN) and Event.Start / Event.End / Event.Token
├── position.ts             # Absolute / Relative position (iterative .get() with cycle guard)
├── range.ts                # Range (abstract parent of Interval + DataToken)
├── interval.ts             # Interval — internal parse-tree node
├── datatoken.ts            # DataToken — leaf (text content)
├── utils.ts                # Tree utilities (toTree, descendants, builders)
├── scanners/
│   ├── match.ts            # KMP matcher
│   ├── any.ts              # Character-class inclusion
│   ├── not.ts              # Character-class exclusion
│   ├── race.ts             # Parallel ordered-choice matcher
│   ├── search.ts           # Pushdown-automaton engine (drives the parse)
│   ├── searchbuilder.ts    # Builds SearchStateFactory from grammar declarations
│   ├── searchstate.ts      # Runtime state for one pushdown frame
│   └── searchop.ts         # Operations (PUSH / GOTO / TERMINAL)
└── vendor/
    └── generics/           # Minimal shims: Queue, Link, IndexMap, UUID, closure, emittable, log, functions
```

## Notes on behavior

A few things worth knowing if you're adapting code that used an earlier build of this parser:

- **`Relative.get()` walks iteratively with a cycle guard.** `Range.updateEnd` rewrites `this.end = Position.relative(this.length, this.start)` on parents and right-siblings whenever a child is appended, which can produce reference chains deep enough to blow the stack or form cycles outright. `Relative.get()` detects cycles and returns the partial sum rather than locking up.
- **Scanner terminal signals cache the real result object.** `Match`, `Any`, `Not`, and `Search` keep a reference to the terminal `result` (not a JSON clone of it), so `value.data` preserves `DataToken` / `Event.Start` / `Event.End` prototypes and `instanceof` checks keep working on re-queried terminals.

## Smoke test

```bash
npm run build
npm run smoke
```

Asserts two end-to-end paths:

1. **KMP match fires inside a host document** — `after(match('hello')).goto('doc')` on input `'say hello world'` produces an `Interval('doc')` containing a `token:say ` leaf and a `match:hello` interval.
2. **Push / terminate nests intervals** — `( ... )` grammar on input `'x(inner stuff)y'` produces an `Interval('doc.body')` at the correct position range (2..14).

## Known limitations

- **Race lookahead reset on GOTO.** When a transition fires `.goto(state)` and the target state's lookahead is itself a `Race` over multiple patterns, the Race scanner appears to retain its completed terminal rather than reinitialize for the next input region. A case that matched `cat | dog | fish` in sequential positions detected only the first match. The underlying state-machine transition is correct (the pushdown stack is fine); the issue is in how `SearchState` obtains a fresh lookahead scanner on state re-entry. Workaround: structure grammars so repeated alternation happens via `push` / `terminate` of a sub-state rather than `goto` within the same state.
- **Streaming is synchronous under the hood.** `IncrementalSink.resolve(msg)` is called eagerly as events are emitted, not via a backpressure-aware stream. For true streaming, pair this with your own backpressure layer.

## License

MIT
