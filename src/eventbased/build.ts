import { PatternTypes, Scanner, ScannerFactory, ScannerOptions } from './scanner.js';
import { Match } from './scanners/match.js';
import { Race } from './scanners/race.js';

type OperationArguments = {
  PUSH: [string];
  POP: [number];
};

/**
 * Operations applied to an AST during a search transition.
 */
export class Operation<T extends keyof OperationArguments> {
  constructor(
    public readonly type: T,
    public readonly args: OperationArguments[T]
  ) {}
}

/**
 * One child scanner in the race that resolves a state's next transition.
 */
type Lookahead = {
  bound: 'FROM' | 'AFTER';
  scannerFactory: ScannerFactory;
};

/**
 * One lookahead + the operations to apply when it wins the race.
 */
export class Transition {
  constructor(
    public lookahead: Lookahead,
    public operations: Operation<'PUSH' | 'POP'>[]
  ) {}
}

/**
 * Fluent builder used by grammar DSL code to accumulate lookaheads and
 * operations before compiling them to concrete Transitions.
 */
export class TransitionBuilder {

  constructor(
    private lookaheads: Lookahead[] = [],
    private operations: Operation<'PUSH' | 'POP'>[] = []
  ) {}

  from(factory: ScannerFactory | PatternTypes): TransitionBuilder {
    const scannerFactory = ((factory as any).create !== undefined) ?
      factory as ScannerFactory : Match.factory([factory as PatternTypes]);
    this.lookaheads.push({ bound: 'FROM', scannerFactory });
    return this;
  }

  after(factory: ScannerFactory | PatternTypes): TransitionBuilder {
    const scannerFactory = ((factory as any).create !== undefined) ?
      factory as ScannerFactory : Match.factory([factory as PatternTypes]);
    this.lookaheads.push({ bound: 'AFTER', scannerFactory });
    return this;
  }

  push(name: string): TransitionBuilder {
    this.operations.push(new Operation<'PUSH'>('PUSH', [name]));
    return this;
  }

  terminate(num: number = 1): TransitionBuilder {
    this.operations.push(new Operation<'POP'>('POP', [num]));
    return this;
  }

  goto(name: string): TransitionBuilder {
    this.operations.push(new Operation<'POP'>('POP', [1]));
    this.operations.push(new Operation<'PUSH'>('PUSH', [name]));
    return this;
  }

  build(): Transition[] {
    if (this.lookaheads.length === 1) {
      return [ new Transition(this.lookaheads[0], this.operations) ];
    }
    return this.lookaheads.map((lookahead, i) => {
      let operations: Operation<'PUSH' | 'POP'>[];
      if (i === 0) {
        operations = [
          new Operation<'PUSH'>('PUSH', [`${this.lookaheads[i + 1].bound}:${this.lookaheads[i + 1].scannerFactory.name}`])
        ];
      } else if (i < this.lookaheads.length - 1) {
        operations = [
          new Operation<'POP'>('POP', [1]),
          new Operation<'PUSH'>('PUSH', [`${this.lookaheads[i + 1].bound}:${this.lookaheads[i + 1].scannerFactory.name}`])
        ];
      } else {
        operations = [
          new Operation<'POP'>('POP', [1]),
          ...this.operations
        ];
      }
      return new Transition(lookahead, operations);
    });
  }
}

/**
 * One branch scanner checked when a search state terminates. Branch
 * scanners read back over the state's output buffer to attach retroactive
 * metadata to the emitted Start event.
 */
export class Branch {
  constructor(public scanner: Scanner) {}
}

export class BranchBuilder {
  constructor(private factory: ScannerFactory) {}

  build(options: ScannerOptions): Branch {
    return new Branch(this.factory.create(options));
  }
}

/**
 * A fully-built state in a Search: its lookahead race, its branch race,
 * its transition table, and the watermark reader used by branches to
 * replay the state's output.
 */
export class State {
  constructor(
    public name: string,
    public builder: StateBuilder,
    public lookahead: Scanner,
    public branches: Scanner,
    public transitions: Map<string, Transition>,
    public reader: number,
    public children: Map<string, StateBuilder>
  ) {}
}

/**
 * Builder for states. Holds the builders for this state's transitions,
 * branches, and nested states; exposes `build()` to instantiate them.
 *
 * The constructor inlines the "middle" of multi-lookahead transitions as
 * synthesised nested states — so `from('a').after('b').push('c')` compiles
 * to a parent state that pushes an intermediate state to match 'b' and
 * only then applies the push.
 */
export class StateBuilder {

  public parent: StateBuilder;
  public children: Map<string, StateBuilder>;

  constructor(
    public part: string,
    public transitionBuilders: TransitionBuilder[],
    public branchBuilders: BranchBuilder[],
    public stateBuilders: StateBuilder[]
  ) {
    const internalBuilders: StateBuilder[] = [];
    this.stateBuilders.forEach(builder => {
      builder.parent = this;
    });
    this.transitionBuilders.map(builder => builder.build()).forEach(transitionList => {
      transitionList.forEach((transition, i) => {
        if (i > 0) {
          const last = transitionList[i - 1];
          const builder = new StateBuilder(
            String(last.operations[last.operations.length - 1].args[0]),
            [ new TransitionBuilder([ transition.lookahead ], transition.operations) ],
            [],
            []
          );
          builder.parent = this;
          internalBuilders.push(builder);
        }
      });
    });
    this.children = new Map(
      this.stateBuilders.concat(internalBuilders).map(builder => [ builder.part, builder ])
    );
  }

  build(reader: number, options: ScannerOptions = {}): State {
    const lookaheadScanners: Scanner[] = [];
    const transitions = new Map<string, Transition>();

    this.transitionBuilders.map(builder => builder.build()).forEach(transitionList => {
      lookaheadScanners.push(transitionList[0].lookahead.scannerFactory.create(options));
      transitionList.forEach((transition) => {
        transitions.set(transition.lookahead.scannerFactory.name, transition);
      });
    });
    const branchScanners = this.branchBuilders.map(builder => builder.build(options).scanner);

    const lookahead = new Race(lookaheadScanners, options);
    const branches = new Race(branchScanners, options);

    return new State(
      this.name,
      this,
      lookahead,
      branches,
      transitions,
      reader,
      this.children
    );
  }

  get name(): string {
    return (this.parent !== undefined) ? (`${this.parent.name}.${this.part}`) : this.part;
  }
}

/** Any nested builder used to define a state. */
export type Builder = TransitionBuilder | BranchBuilder | StateBuilder;
