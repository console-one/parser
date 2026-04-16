/**
 * Minimal streaming sink interface for incremental parse event emission.
 *
 * The parser emits `{ kind: 'start'|'end'|'token', ... }` records to a sink
 * as it builds the parse tree. Callers that want incremental/streaming
 * delivery implement this; callers that only want the final tree pass
 * nothing.
 *
 * Replaces a heavier Publisher/Subscribable framework from the source repo —
 * the parser only ever called `.resolve(msg)` on the thing, so that's all
 * we expose here.
 */
export interface IncrementalSink {
  resolve(msg: {
    kind: 'start' | 'end' | 'token'
    name?: string
    data?: any
    position?: any
    metadata?: any
    updated?: any
    uuid?: string
  }): void
}
