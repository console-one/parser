

export const times = (num: number, str: string) => {
  let result = '';
  for (let i = 0; i < num; i++) result += str;
  return result;
}

export type Key = string | number | symbol

export const underride = <K1 extends Key, V1, K2 extends Key, V2>(a: Record<K1, V1>, b: Record<K2, V2>): Record<K1 | K2, V1 | V2> => {
  let c: Record<any, V1 | V2> = {}
  for (let val of Object.keys(a)) c[val] = a[val];
  for (let val of Object.keys(b)) if (a[val] === undefined) c[val] = b[val];
  return c;
}

export const override = <K1 extends Key, V1, K2 extends Key, V2>(a: Record<K1, V1>, b: Record<K2, V2>): Record<K1 | K2, V1 | V2> => {
  let c: Record<K1 | K2 | any, V1 | V2 | any> = {};
  for (let val of Object.keys(a)) if (b[val] === undefined) c[val] = a[val];
  for (let val of Object.keys(b)) c[val] = b[val];
  return c;
}


export const join = (a: Record<any, any>, b: Record<any, any>) => {
  let joinResult = {};
  let conflicts = [];
  for (let key of Object.keys(a)) {
    joinResult[key] = a[key];
  }
  for (let key of Object.keys(b)) {
    if (joinResult[key] === undefined) joinResult[key] = b[key];
    else {
      joinResult[key] = [joinResult[key], b[key]];
      conflicts.push(key);
    }
  }
  if (conflicts.length > 0) {
    console.error("Cannot perform join due to conflicts: ");
    for (let key of Object.keys(conflicts)) {
      console.error(key + " => ", ...joinResult[key])
    }
    throw new Error("Join error due to conflicts in keys: " + conflicts.join(','))
  }
  return joinResult;
}