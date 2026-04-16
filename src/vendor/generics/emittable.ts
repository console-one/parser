export class Emittable<T=any> {

  private resultPromise: Promise<T>
  private resolver: any
  private rejecter: any 
  private emitted: boolean
  private starttime: number 
  private terminatedPromise: Promise<{ starttime: number, result: 'success' | 'rejection'}> 
  private terminatedResolver: any
  
  public details: any
  public data: { type: 'success' | 'rejection', value: T | Error }

  constructor() {

    this.terminatedPromise = new Promise<{ starttime: number, result: 'success' | 'rejection'}>((resolve, reject) => {
      this.terminatedResolver = resolve;
      this.starttime = new Date().getTime();
    })

    this.resultPromise = new Promise<T>((resolve, reject) => {
      this.setResolver(resolve);
      this.setRejecter(reject);
    });

    this.emitted = false;
  }

  get constructed() {
    return this.succeeded && this.resolver !== undefined || 
      this.failed && this.rejecter !== undefined || 
      this.resolver !== undefined && this.rejecter !== undefined; 
  }

  get settled() {
    return this.data !== undefined
  }

  get pending() {
    return !this.settled;
  }

  get succeeded() {
    return this.data !== undefined && this.data.type === 'success'
  }

  get failed() {
    return this.data !== undefined && this.data.type === 'rejection'
  }

  get value(): Promise<T> {
    return this.resultPromise;
  }

  get terminated(): Promise<{ starttime: number, result: 'success' | 'rejection'}> {
    return this.terminatedPromise;
  }

  private tryResolve() {
    if (this.settled && this.succeeded && !this.emitted && this.constructed) {
      this.emitted = true;
      this.resolver(this.data.value); 
      this.terminatedResolver({ starttime: this.starttime, result: 'success' });
    } else if (this.settled && this.failed && !this.emitted && this.constructed) {
      this.emitted = true;
      this.rejecter(this.data.value);
      this.terminatedResolver({ starttime: this.starttime, result: 'rejection' });
    }
  }

  private setResolver(fn: any) {
    this.resolver = fn;
    this.tryResolve();
  }

  private setRejecter(fn: any) {
    this.rejecter = fn;
    this.tryResolve();
  }

  resolve(data: T) {
    this.data = { type: 'success', value: data };
    this.tryResolve();
  }

  reject(error: Error) {
    this.data = { type: 'rejection', value: error };
    this.tryResolve();
  }

}