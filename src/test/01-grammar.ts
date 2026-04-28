// ─────────────────────────────────────────────────────────────────────────
// Grammar DSL: define + after + match + push + terminate produce a working
// pushdown parser. Mirrors the smoke's two enabled cases (caseSingleMatch,
// casePushTerminate). The Race / Not-based word-carving cases are still
// open issues per the smoke's commented-out cases.
// ─────────────────────────────────────────────────────────────────────────

import { v4 as uuid } from 'uuid';
import {
  after,
  build,
  define,
  from,
  match,
  not,
  Interval,
  type Search,
} from '../index.js';

function run(grammar: any, initial: string, input: string): Interval {
  const search: Search = build(grammar, initial, uuid());
  let pos = 0;
  for (const ch of input) {
    search.shift({ done: false, value: { index: pos, data: ch } });
    pos += 1;
  }
  search.shift({ done: true, value: { index: Math.max(pos - 1, 0) } });
  return search.rootInterval;
}

function firstIntervalNamed(root: Interval, name: string): Interval | undefined {
  for (const child of root.children()) {
    if (child instanceof Interval) {
      if (child.name === name) return child;
      const deeper = firstIntervalNamed(child, name);
      if (deeper) return deeper;
    }
  }
  return undefined;
}

export default async (test: (name: string, body: (validator: any) => any) => any) => {
  await test('Match scanner fires once on a literal embedded in the document', async (validator: any) => {
    const g = define('doc', after(match('hello')).goto('doc'));
    const tree = run(g, 'doc', 'say hello world');
    const matchChildren = Array.from(tree.children()).filter(
      (c) => c instanceof Interval && c.name.startsWith('match:'),
    );
    return validator.expect({
      isInterval: tree instanceof Interval,
      rootName: tree.name,
      matches: matchChildren.length,
    }).toLookLike({ isInterval: true, rootName: 'doc', matches: 1 });
  });

  await test('push + terminate carves a balanced () body into a nested interval', async (validator: any) => {
    const g = define(
      'doc',
      after(match('(')).push('body'),
      define(
        'body',
        from(not(')')).goto('body'),
        after(match(')')).terminate(),
      ),
    );
    const tree = run(g, 'doc', 'x(inner stuff)y');
    const body = firstIntervalNamed(tree, 'doc.body');
    return validator.expect({
      bodyExists: body !== undefined,
      hasStartLessThanEnd: body ? body.start.get() < body.end.get() : false,
    }).toLookLike({ bodyExists: true, hasStartLessThanEnd: true });
  });
};
