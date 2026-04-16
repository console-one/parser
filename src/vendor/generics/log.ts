import { Queue } from './queue.js';

/**
 * The Logs class provides logging functionality with different modes of operation.
 * It supports immediate logging as well as deferred logging via a queue.
 */
export class Logs {
  
  /** Identifier for the logger instance */
  name: string; 
  
  /** Queue to hold log entries in 'OFFLINE' mode */
  q: Queue<any>; 
  
  /** Function to be executed when an error is logged */
  onError: (...args: any[]) => void; 
  
  /** Function to be executed when a log entry is printed */
  onPrint: (...args: any[]) => void; 
  
  /** Operating mode ('OFFLINE' or 'ASAP') */
  mode: 'OFFLINE' | 'ASAP'; 

  /**
   * Initializes the logger with a name and optional custom error and print functions.
   * @param name - The name of the logger
   * @param options - Optional custom functions for handling errors and print operations
   */
  constructor(
    name: string,
    options: {
      error?: (...args: any[]) => void,
      print?: (...args: any[]) => void
    } = {}
  ) {
    this.name = name;
    this.mode = 'OFFLINE';
    this.q = new Queue<any>();
    this.onError = options.error ?? ((...args) => console.error(...args));
    this.onPrint = options.print ?? ((...args) => console.log(...args));
  }

  /**
   * Switches the logger to 'ASAP' mode and flushes the queue.
   */
  asap() {
    this.mode = 'ASAP';
    this.print(); // Flush the queue  
  }

  /**
   * Writes log entries based on the current operating mode.
   * @param args - The content to be logged
   */
  write(...args: any[]) {
    // const globalLogger = GlobalLogger.getInstance();
    // if (globalLogger.shouldLog(this.name)) {
    //   if (this.mode === 'ASAP') {
    //     this.onPrint(...args);
    //   } else {
    //     this.q.push(args);
    //   }
    // }

    if (this.mode === 'ASAP') {
      this.onPrint(...args);
    } else {
      this.q.push(args);
    }
  }

  /** Clears the log queue */
  clear() {
    this.q.clear();
  }

  /** Flushes the log queue and logs the errors using the error function */
  error() {
    while (this.q.length > 0) {
      this.onError(...this.q.shift());
    }
  }

  /** Flushes the log queue and prints log entries using the print function */
  print() {
    while (this.q.length > 0) {
      this.onPrint(...this.q.shift());
    }
  }
}
