


export type OperationTypes = {



  PUSH: [string, [string, string?][]?],

  PUSH_TO: [string, [string, string?][]?],

  POP: [number?],
  
  POP_TO: ['<' | '<=', string | string[]],

  GOTO: [string, [string, string?][]?]


}

export class Operation<T extends keyof OperationTypes> {
  constructor(public type: T, public args: OperationTypes[T]) { }
}