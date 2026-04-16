
export type QueueOptions<T> = {
  pipe?: (item: T) => T
  chain?: () => Queue<T>
}

export type QueueItem<T> = {
  next?: QueueItem<T>
  prev?: QueueItem<T>
  data?: T
}

export type QueueEventHandler<T> = ((data: any, state: Queue<T>) => void)

export type QueueListeners<T> = {
  [key: string | number]: {
    ids: number,
    handlers: { [key: string | number]: QueueEventHandler<T> }
  }
}

export class Queue<T> {

  public size: number
  public maxSize: number
  public first: QueueItem<T> | undefined
  public last: QueueItem<T> | undefined
  private pipe: (item: T) => T
  private chain: () => Queue<T> 
  private listeners: QueueListeners<T>
  private ids: number

  constructor(maxSize: number = Number.POSITIVE_INFINITY, options: QueueOptions<T> = {}) {
    this.size = 0;
    this.maxSize = maxSize;
    this.pipe = options['pipe'] ? options.pipe : (i) => i;
    this.chain = options['chain'] ? options.chain : () => new Queue<T>();
    this.listeners = {};
    this.ids = 0;
  }

  isEmpty() : boolean {
    return this.length < 1; 
  }

  prepend(data: T) {
    let results = [];
    let next: QueueItem<T> = {};
    next.data = data;
    if (!this.isEmpty()) {
      next.next = this.first;
      this.first.prev = next;
      this.first = next;
    } else {
      this.first = next;
      this.last = next;
    }
    this.size += 1;
    if (this.size > this.maxSize) {
      for (let item of this.flush(this.size - this.maxSize)) {
        results.push(item);
      }
    }
    return this;
  }

  concat(other: Queue<T>) {
    for (let data of other.toArray()) {
      this.push(data);
    }
    return this;
  }

  peak() : T {
    if (!this.isEmpty()) return this.first.data;
    throw new Error('Cannot peak on empty queue');
  }

  remove() : T {
    if (this.isEmpty()) throw new Error('Cannot pull from empty queue');
    let result = this.first.data;
    this.size-=1;
    this.first = this.first.next;

    if (this.first !== null && this.first !== undefined && (this.first.next === null || this.first.next === undefined)) {
      this.last = this.first;
    } else if (this.first === null || this.first === undefined) {
      this.last = this.first;
    }

    return result;
  }

  pull() : T {
    return this.pipe(this.remove());
  }

  * nodes() {
    let next = this.first;
    let iterations = 0;
    while ((next !== null || next !== undefined)) {
      yield next;
      iterations += 1;
      next = next.next;
    }
    return;
  }

  on(method: any, create: (unsub: () => any) => QueueEventHandler<T>) {
    let id = this.ids;
    this.ids += 1;
    if (this.listeners[id] === undefined) {
      this.listeners[id] = {
        ids: 0,
        handlers: {}
      }
    }
    let listenerID = this.listeners[id].ids;
    this.listeners[id].ids += 1;
    this.listeners[id].handlers[listenerID] = create(() => {
      delete this.listeners[id].handlers[listenerID];
    });
  }

  push(...datum: T[]) {

    let results: Queue<T> = this.chain();

    let emitted: QueueItem<T>[] = [];

    for (let data of datum) {
      let next: QueueItem<T> = {};
      next.data = data;
      emitted.push(next);
      if (!this.isEmpty()) {
        next.prev = this.last;
        this.last.next = next;
        this.last = next;
      } else {
        this.first = next;
        this.last = next;
      }
      this.size+=1;
      if (this.size > this.maxSize) {
        for (let item of this.flush(this.size - this.maxSize)) {
          results.push(item);
        }
      }
    }

    while (this.listeners['push'] !== undefined) {
      for (let handler of Object.values(this.listeners['push'].handlers)) {
        handler(emitted, this);
      }
    }

    return results;
  }

  * readHead(n = this.size) : Generator<T> {
    let next = this.first;
    let iterations = 0;
    while ((next !== null && next !== undefined) && (iterations < n)) {
      yield next.data;
      iterations += 1;
      next = next.next;
    }
    return;
  }

  * readTail(n = this.size) : Generator<T> {
    let next = this.last;
    let iterations = 0;
    while ((next !== null && next !== undefined) && (iterations < n)) {
      yield next.data;
      iterations += 1;
      next = next.prev;
    }
    return;
  }

  atIndex(n = this.size) {
    let next;
    if (n < 0) {
      next = this.last;
      n = n * -1;
    } else {
      next = this.first;
    }
    let iterations = 0;
    while ((next !== null || next !== undefined) && (iterations < n)) {
      iterations += 1;
      next = next.prev;
    }
    return next.data;
  }

  read(cb: (item: T) => void) : void {
    for (let item of this.readHead()) {
      cb(item);
    }
  }

  get length () : number {
    return this.size;
  }

  shift() : T {
    return this.pull();
  }

  toArray() : T[] {
    let result = [];
    for (let item of this.readHead()) result.push(item);
    return result;
  }

  clear() : Queue<T> {
    this.size = 0;
    this.first = null;
    this.last = null;
    return this;
  }

  * flush(n: number = this.maxSize) : Generator<T> {
    let iterations = Math.min(Math.max(n, 0), this.size);
    let count = 0;
    while (count < iterations) {
      yield this.pull();
      count += 1;
    }
    return;
  }

  headIs(pred: (head: T) => boolean) {
    return (!this.isEmpty() && pred(this.peak()));
  }

  toString() {
    return JSON.stringify(this.toArray(), null, 1);
  }

  insert(data: any): { before: (next: QueueItem<T>) => any, after: (prev: QueueItem<T>) => any } {
    let _this = this;
    return {
      
      before(next: QueueItem<T>) {
        let node: QueueItem<T> = {};
        node.data = data;
        node.prev = next.prev;
        if (node.prev !== undefined) node.prev.next = node;
        else (_this.first = node);
        node.next = next;
        next.prev = node;
        return _this;
      },

      after(node: QueueItem<T>) {
        let next: QueueItem<T> = {};
        next.data = data;
        next.prev = node;
        next.next = node.next;
        node.next = next;
        if (next.next !== undefined) next.next.prev = next;
        else (_this.last = next);
        return _this;
      }
    }
  }

  [Symbol.iterator]() {
    return this.readHead(this.size);
  };

  static describes(item: any) {
    return item instanceof Queue;
  }

  static fromArray<T>(arr: T[]): Queue<T> {
    let q = new Queue<T>();
    for (let item of arr) {
      q.push(item);
    }
    return q;
  }

  static of<T>(...args: T[]): Queue<T> {
    let q = new Queue<T>();
    q.push(...args);
    return q;
  }
}
