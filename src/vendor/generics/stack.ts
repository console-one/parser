export class Stack<T> {

  impl: T[];

  constructor() {
    this.impl = [];
  }

  push(val: T) {
    this.impl.push(val);
    return this;
  }

  pop() {
    return this.impl.pop();
  }

  get length() {
    return this.impl.length;
  }

  peak() {
    return this.impl[this.impl.length - 1];
  }

  peakIf(pred: (top: T) => boolean) {
    return this.impl.length > 0 && pred(this.peak());
  }

  setTop(data: T) {
    this.impl[this.impl.length - 1] = data;
    return this;
  }

  toArray() {
    return this.impl.map(i => i);
  }
}
