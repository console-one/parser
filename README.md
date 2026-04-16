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

## What was intentionally dropped during extraction

Source: `console-one-workspace/web-server/server/src/core/parser/` (commit `2962816ed487df0a3c029401b94d7db32fc27ff2`).

### Dead code (never imported by production code — verified via grep)

- `select.ts` (root-level) — a `SearchBuilder`-based path-typed state machine (`PathTypes`) that declared states but never exported anything; `InitialTypes` was assigned and unused. Only imported by one test spec.
- `selectors/` (whole directory — `elementfactory.ts`, `searchbuilder.ts`, `searchelement.ts`, `searchpath.ts`, `searchstate.ts`, `searchterms.ts`, `searchtype.ts`) — supporting files for the above. No production caller.
- `scanners/select.ts` — pulled in `SyncOperatorDefinitions` + `AsArray` from the testing framework. Only referenced by a test spec.
- `segment.ts` — no imports anywhere.
- `ast.ts` — defined `AST`, `ASTId`, `Parameter` types that pulled in `MetadataSet` and `Encoding` from outside the parser; never imported by anything *inside* the parser.
- `EventListener` mixin on `Interval` — `Interval` extended `Mixin(Range, EventListener)` from `ts-mixer`, but nothing in the parser or its callers invoked `register()` or `invoke()`. Dropped the mixin, kept plain `extends Range`.
- Proxy-based `Tree` / `Points` / `LinearDimension` / `DimensionPoint` / `Pipe` / `Token` / `Scope` / `Step` classes at the top of `searchstate.ts` — ~200 lines of unfinished classifier / pipeline experiment, never referenced by the `SearchStateBuilder` class below them. Dropped.
- `console-log-tree`-based `logtree` / `color` / `highlight` in `utils.ts` — pretty-print helpers with external deps. Dropped; kept only `toTree`, `descendants`, `filter`, `IntervalBuilder`, `TokenBuilder`, `tokenstring`.

### Entire subsystems dropped

- **`eventbased/` directory.** The event-based streaming rewrite — watermark flow control, push-based event queue, parallel feeders. Per the source's own `parser-eventbased-why.md`: "This version was never fully stabilized; the watermark garbage collection in the Race scanner had edge cases that were rewritten three times without resolution." We ship the synchronous version which the doc says works. See `parser-eventbased-why.md` in the source docs for the backstory.
- **`serializers/` directory** (`baserangeserializer`, `datatokenserializer`, `intervalserializer`, `positionserializer`, `rangeserializer`) — pulled in the whole `@dipscope/type-manager` + `src/core/serialization/` layer for round-tripping parse trees. Out of scope for a parser; would ship as a sibling `@console-one/parser-serde` package if needed.
- **`src/core/streams/` integration** (`Publisher`, `Subscribable`, `BufferWindowPublisher`, `Message`, etc.). The parser only ever called `.resolve(msg)` on a publisher to emit incremental events. Replaced the whole framework with a single-method `IncrementalSink` interface (`src/incremental.ts`).
- **Serialization decorators** (`@Type()`, `@Property()`, `@Inject()` from `@dipscope/type-manager`) on `Range`, `Interval`, `DataToken`, `Position`. Decoration without runtime reflection was a no-op; dropped alongside the serializers.
- **`ts-mixer`, `linked-list-typescript`** — the first was for the `EventListener` mixin (dead), the second was one call site in `Interval.text` that a two-line array join replaces.
- **`GlobalLogger`** (from `core/generics/globallogger.ts`) — pulled in `aws-sdk` at runtime to write CloudWatch logs from Lambda. The `Logs` class (used by `Search`) never actually called into GlobalLogger; the import was dead. Dropped.
- **`LinkedHeap`, `proxyutils`** — only used by the dead `LinearDimension` / `DimensionPoint` block above. Dropped with the block.

## Bugs fixed during extraction

Documented here because they would have affected live callers; keeping them honest.

### `Relative.get()` infinite recursion

`src/position.ts` — `Relative.get()` was `return this.reference.get() + this._offset;`. Under `Range.updateEnd`, which rewrites `this.end = Position.relative(this.length, this.start)` on parents and right-siblings every time a child is appended, the reference chain can grow unbounded or form a cycle outright. Recursive `.get()` crashes with "Maximum call stack size exceeded" once the cycle closes.

Reproduced this crash on the case-2 smoke test (`x(inner stuff)y`) before the fix. Fix: iterative walking with a `Set<instanceId>`-based cycle guard. If a cycle is detected we return the partial sum rather than lock up — the tree structure stays correct, only the integer position stored on Events may be off for the affected nodes. A proper fix is to make Range stop rebuilding Relative chains on every updateEnd; that's a behavior change beyond extraction scope.

### JSON-clone of terminal signal destroying class instances

`src/scanners/match.ts`, `any.ts`, `not.ts`, `search.ts` — on completion each scanner was caching its final signal as `this.terminal = JSON.parse(JSON.stringify(result))`, then returning that on every subsequent `.shift()`. The clone serialized `value.data` (arrays of `DataToken`, `Event.Start`, `Event.End` instances) to plain JSON objects and back, stripping their prototypes. Any downstream `instanceof DataToken` / `instanceof Event` check on a re-queried terminal failed silently.

Fix: cache the original `result` reference — the terminal is only read, never mutated.

### `withold` → `withhold` typo

`src/scanners/any.ts`, `not.ts` — config was initialized `{ withold: false }` (missing one `h`) but the check site read `configurations.withhold`. The flag was silently dead-on-arrival. Fixed the initializer; the conditional now functions as originally intended (though no shipped caller sets it).

## Smoke test

```bash
npm run build
npm run smoke
```

Asserts two end-to-end paths:

1. **KMP match fires inside a host document** — `after(match('hello')).goto('doc')` on input `'say hello world'` produces an `Interval('doc')` containing a `token:say ` leaf and a `match:hello` interval.
2. **Push / terminate nests intervals** — `( ... )` grammar on input `'x(inner stuff)y'` produces an `Interval('doc.body')` at the correct position range (2..14).

## Known limitations (not fixed during extraction)

Carried over as-is from the source; mentioned here so callers know.

- **Race lookahead reset on GOTO.** When a transition fires `.goto(state)` and the target state's lookahead is itself a `Race` over multiple patterns, the Race scanner appears to retain its completed terminal rather than reinitialize for the next input region. A smoke case that matched `cat | dog | fish` in sequential positions detected only the first match and stopped. The underlying state-machine transition is correct (the pushdown stack is fine); the issue is in how `SearchState` obtains a fresh lookahead scanner on state re-entry. Workaround: structure grammars so repeated alternation happens via `push`/`terminate` of a sub-state rather than `goto` within the same state. Proper fix: audit `SearchState.apply` / lookahead factory invocation.

- **Streaming incremental parse is synchronous under the hood.** `IncrementalSink.resolve(msg)` is called eagerly as events are emitted, not via a backpressure-aware stream. For true streaming, pair this with your own backpressure layer; see `parser-eventbased-why.md` in the source docs for an extended discussion of why the event-based rewrite stalled.

## Origin

Source commit: `2962816ed487df0a3c029401b94d7db32fc27ff2` in `console-one-workspace/web-server/server/src/core/parser/`.

Associated source docs (outside this package but referenced):
- `parser-sync-why.md` — the architecture & scanner primitives
- `parser-eventbased-why.md` — the rewrite that didn't land, and why

## License

MIT
