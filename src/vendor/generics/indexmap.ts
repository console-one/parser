
export class IndexMap<T> {

  map: { [key: string]: T }
  counter: number
  size: number
  available: Set<string>

  constructor() {
    this.map = {};
    this.counter = 0;
    this.available = new Set<string>();
    this.size = 0;
  }

  store(item: T) {
    let count = this.counter;
    this.counter += 1;
    this.map[count + ''] = item;
    this.size += 1;
    return count + '';
  }

  has(key: any) {
    return this.map[key + ''] !== undefined
  }

  get(key: string) {
    return this.map[key + ''];
  }

  delete(key: string) {
    let retval = (this.map[key + ''] !== undefined);
    delete this.map[key + ''];
    this.size -= 1;
    return retval;
  }

  lock() {
    let count = this.counter;
    this.available.add(count + '');
    this.counter += 1;
    this.size += 1;
    return count + '';
  }

  set(count, value: T) {
    if (!this.available.has(count + '') || this.map[count + ''] !== undefined) {
      throw new Error("Setting on forbidden or claimed key of " + count)
    }
    this.available.delete(count + '');
    this.map[count + ''] = value;
  }

  entries() {
    return Array.from(Object.entries(this.map))
  }

  values() {
    return Array.from(Object.values(this.map))
  }

  keys() {
    return Array.from(Object.keys(this.map))
  }

}
