// ─────────────────────────────────────────────────────────────────────────
// computeLPSArray (KMP failure-function): public helper used by the Match
// scanner. Stable, deterministic, and worth pinning.
// ─────────────────────────────────────────────────────────────────────────

import { computeLPSArray } from '../index.js';

export default async (test: (name: string, body: (validator: any) => any) => any) => {
  await test('computeLPSArray on a non-self-similar pattern is all zeros', async (validator: any) => {
    return validator.expect(computeLPSArray('abcd')).toLookLike([0, 0, 0, 0]);
  });

  await test('computeLPSArray on "ababab" walks 0,0,1,2,3,4', async (validator: any) => {
    return validator.expect(computeLPSArray('ababab')).toLookLike([0, 0, 1, 2, 3, 4]);
  });

  await test('computeLPSArray on a single-character pattern is [0]', async (validator: any) => {
    return validator.expect(computeLPSArray('z')).toLookLike([0]);
  });

  await test('computeLPSArray on a repeated character is incremented in place', async (validator: any) => {
    return validator.expect(computeLPSArray('aaaa')).toLookLike([0, 1, 2, 3]);
  });
};
