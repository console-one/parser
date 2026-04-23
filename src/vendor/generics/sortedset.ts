import { Heap } from 'heap-js';

export class SortedSet<T> {

  heap: Heap<T>;
  items: { [key: string | number | symbol]: T };
  itemCount: number;

  constructor(
    comparator: (a: T, b: T) => number,
    public indexer: (item: T) => number | string | symbol
  ) {
    this.heap = new Heap(comparator);
    this.items = {};
    this.itemCount = 0;
  }

  push(item: T) {
    const itemKey = this.indexer(item);
    if (this.items[itemKey] === undefined) {
      this.items[itemKey] = item;
      this.heap.push(item);
    }
    this.itemCount += 1;
  }

  pop() {
    const next = this.heap.pop();
    const itemKey = this.indexer(next);
    delete this.items[itemKey];
    this.itemCount -= 1;
    return next;
  }

  peek() {
    return this.heap.peek();
  }

  has(item: T) {
    const itemKey = this.indexer(item);
    return this.items[itemKey] !== undefined;
  }

  get length() {
    return this.itemCount;
  }
}

export class SortedNumericalSet extends SortedSet<number> {
  constructor(...values: number[]) {
    super((a, b) => a - b, (item) => item);
    for (const item of values) this.push(item);
  }
}
