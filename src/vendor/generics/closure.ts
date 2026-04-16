
export class Closure extends Function {

  
  // @ts-ignore
  constructor(fn, props = {}) {
    super()
    return Object.setPrototypeOf(fn, new.target.prototype);
  }

  static nextTick(cb) {
    if (typeof process === "object" &&  typeof require === "function") {
      return process.nextTick(cb);
    } else {
      return Promise.resolve().then(cb);
    }
  }
}



export type MapperOf<Input extends any[], Output> = (...args: Input) => Output


export class Functional<Input extends any[], Output> extends Function {
  constructor(fn: any, props = {}) {
    super()
    return Object.setPrototypeOf(fn, new.target.prototype) as this;
  }
}


export class Loggable extends Closure {
  shouldTrace: boolean
  fnName: string
  // @ts-ignore
  constructor(fn, shouldTrace = false) {
    super((...args) => {
      if (this.shouldTrace) {
        console.log(`${this.fnName} ran with: `, ...args)
      }
      let result = fn(...args);
      if (this.shouldTrace) {
        console.log(`${this.fnName} result: `, ...args)
      }
      return result;
    })

    this.shouldTrace = shouldTrace;
    if (fn.hasOwnProperty('name') && fn.name.length > 0) {
      this.fnName = fn.name;
    } else {
      this.fnName = this.name;
    }
  }

  trace() {
    this.shouldTrace = true;
  }
}

export class Stateful<FunctionInput, FunctionOutput, SuperMethod> extends Closure {
  // @ts-ignore
  constructor(fn: (input: FunctionInput) => FunctionOutput, props: SuperMethod = {}) {
    super(fn);
    Object.assign(this, props);
  }
}




