import { Scanner, Progress, ScannerFactory } from '../scanner.js';
import { Event } from '../../event.js';

/**
 * Branch scanner that delegates to a child scanner, emitting its output
 * only when the observed start event satisfies `predicate`.
 */
export class Where implements Scanner {

  public id: string;

  /**
   * NOTE: The original branch stored `predicate` but never applied it.
   * Preserving that shape here; the filter semantics need to be defined
   * once Search's branch-processing loop is rewritten (task #4).
   */
  constructor(
    private child: Scanner,
    public readonly predicate: (start: Event.Start) => boolean
  ) {
    this.id = `where:${child.id}`;
  }

  get complete(): boolean {
    return this.child.complete;
  }

  get lastclosed(): number {
    return this.child.lastclosed;
  }

  get lastreceived(): number {
    return this.child.lastreceived;
  }

  reindex(newIndex: number): void {
    this.child.reindex(newIndex);
  }

  shift(event: Event): Progress {
    return this.child.shift(event);
  }

  static factory(child: ScannerFactory, condition: (start: Event.Start) => boolean): ScannerFactory {
    return {
      name: `where`,
      terms: [],
      create: (options) => new Where(child.create(options), condition)
    };
  }
}
