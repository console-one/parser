
import { Queue } from './queue.js'

function onceIfExists(optional, prop) {
  if (optional[prop] !== undefined) {
    let called;
    let call = optional[prop];
    optional[prop] = (...args: any) => {
      if (!called) {
        called = true;
        call(...args);

      }
    }
  }
  return optional;
}

export class Link<ItemType=any> {

  actionQ: ((input: ItemType) => void)[]
  receiver: ItemType

  constructor() {
    this.actionQ = [];
    this.receiver = undefined;
    this.onReceiver = this.onReceiver.bind(this)
    this.setReceiver = this.setReceiver.bind(this)
  }
  
  onReceiver(fn) {
    if (this.receiver === undefined) {
      this.actionQ.push(fn);
    } else {
      fn(this.receiver);
    }
  }
  
  setReceiver(val) {
    this.receiver = val;
    let ref = this.actionQ;
    this.actionQ = [];
    let toDequeue = ref.reduce((_, i) => {
      _.push(i);
      return _; 
    }, []);
    while (toDequeue.length > 0) toDequeue.pop()(this.receiver);
  }
}


/**
 * Creates a bidirectional communication link between a publisher and subscribers.
 *
 * @param onWritten - A callback function to execute when data is written by the publisher.
 * @param onRead - A callback function to execute when data is read by all subscribers.
 * @returns An object with publisher and subscribable functions.
 */
export const link = (options: {
  writeConnect?: (...args: any) => void,
  writeStart?: (...args: any) => void,
  writeFinished?: (...args: any) => void, 
  readConnect?: (...args: any) => void,
  readStart?: (...args: any) => void,
  readFinished?: (...args: any) => void
} = {}) => {

  onceIfExists(options, 'writeConnect')
  onceIfExists(options, 'writeStart')
  onceIfExists(options, 'writeFinished')
  onceIfExists(options, 'readConnect')
  onceIfExists(options, 'readStart')

  let queue =  new Queue();
  let hasPublisher = false;
  let hasSubscriber = false;
  let hasLast = false;

  const dq = () => {
    while (handlers.length > 0 && ((queue.length > 0))) {
      let next = queue.shift();
      options?.writeStart();
      if (next === null) hasLast = true;
      for (let handler of handlers) {
        options?.readStart(next);
        handler.shift(next);
      }
      if (hasPublisher && hasSubscriber && hasLast) options?.readFinished()
    }
  }

  const handlers = [];
  return {
    publisher: (callback) => {
      hasPublisher = true;
      options?.writeConnect();
      return callback((data) => { 
        queue.push(data);
        dq();
      })
    },

    subscribable: (callback) => {
      hasSubscriber = true;
      options?.readConnect();
      return callback((handler) => { 
        handlers.push(handler); 
        dq(); 
      })
    }
  }
}

export const monitored = (emit: (...args: any) => any) => {
  let seq = 0;

  const sink = (name: string) => {
    return (...args) => emit([seq++, name, args])
  }

  return link({
    readConnect: sink('readConnect'),
    writeConnect: sink('writeConnect'),
    readFinished: sink('readFinished'),
    writeFinished: sink('writeFinished'),
    readStart: sink('readStart'),
    writeStart: sink('writeStart')
  });
}