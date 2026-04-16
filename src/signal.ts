
import { DataToken } from './datatoken.js'
import { Range } from './range.js'

export type Signal<DataType, SequenceType> = {
  value: {
    index: SequenceType,
    data?: DataType
  }
  done: boolean
}

export const Signal = {

  of: <K, T>(done: boolean, seq: T, data?: K) => {
    let maybeWithData: Signal<K, T> = {
      done: done,
      value: {
        index: seq
      }
    };

    if (data !== undefined) {
      maybeWithData.value.data = data;
    }
    return maybeWithData;
  },

  done: <K, T>(seq: T, data?: K) => Signal.of<K, T>(true, seq, data),

  next: <K, T>(seq: T, data?: K) => Signal.of<K, T>(false, seq, data),
  

  hasData: (signal: Signal<Range.ReadOutput[], any>) => {
    return signal.value !== undefined
      && signal.value.data !== undefined
      && signal.value.data.length > 0;
  },

  hasSeq: (signal: Signal<any, any>) => {
    return signal.value !== undefined
      && signal.value.index !== undefined;
  },

  toDataToken: (data: Signal<string, number>) => {
    return DataToken.fromSignal(data); 
  },

  describes: (data: any) => {
    return (data.hasOwnProperty('done'));
  },

  closedIndex: (signal: Signal<any, any>) => {
    if (!Signal.hasSeq(signal)) return undefined;
    return signal.value.index;
  },

  isDone: (signal: Signal<any, any>) => {
    return signal.done ? 'COMPLETE' : 'ONGOING';
  }
}
