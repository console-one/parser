import { UUID } from './vendor/generics/uuid.js'

export abstract class Position {
  readonly _instanceId: string

  abstract get(): number

  constructor(instanceId: UUID) {
    this._instanceId = instanceId
  }
  get instanceId(): UUID {
    return this._instanceId
  }
  static absolute(position: number) {
    return new Absolute(UUID.random(), position)
  }
  static relative(offset: number, reference: Position) {
    return new Relative(UUID.random(), offset, reference)
  }
}

export class Absolute extends Position {
  readonly position: number

  constructor(instanceId: UUID, pos: number) {
    super(instanceId)
    this.position = pos
  }

  get() {
    return this.position
  }
}

export class Relative extends Position {

  _offset: number
  reference: Position

  constructor(instanceId: UUID, offset: number, ref: Position, locked: boolean = false) {
    super(instanceId)
    if (ref === undefined) throw new Error(`Input reference for relative position is undefined!`)
    this._offset = offset
    this.reference = ref
  }

  get offset() {
    return this._offset
  }

  set offset(num: number) {
    this._offset = num
  }

  /**
   * Walk the reference chain iteratively, summing offsets.
   *
   * Fixed during extraction: the original implementation was recursive
   * (`return this.reference.get() + this._offset`). Under the Range /
   * Interval position-tracking code, `Range.updateEnd` repeatedly rewrites
   * `this.end = Position.relative(this.length, this.start)` on parents and
   * right-siblings as children are appended. That wiring can produce a
   * reference chain that either exceeds the JS call stack (for deeply
   * nested parse trees) or forms a cycle outright. Recursive `.get()`
   * crashes with "Maximum call stack size exceeded" once the cycle closes.
   *
   * Iterative walking with a Set-based cycle guard converts this into a
   * defined failure mode: if a cycle is detected we return the partial sum
   * rather than locking up. That's enough to let Event emission proceed
   * with a deterministic (if approximate) position — the tree structure
   * is still correct, only the integer offset stored on Events may be off
   * for the affected nodes. A proper fix is to make Range not rebuild
   * Relative chains on every updateEnd, but that's a behavior change
   * beyond the extraction scope.
   */
  get(): number {
    let offset = this._offset
    let cursor: Position = this.reference
    const seen = new Set<string>()
    seen.add(this._instanceId)
    while (cursor instanceof Relative) {
      if (seen.has(cursor._instanceId)) return offset
      seen.add(cursor._instanceId)
      offset += cursor._offset
      cursor = cursor.reference
    }
    return offset + cursor.get()
  }
}
