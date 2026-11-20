import { describe, expect, it } from 'vitest';

import {
  checkPlainJson,
  jsonByteLength,
  MAX_JSON_DEPTH,
} from '../../src/common/contracts/json-size';

// Nested arrays, `levels` deep: [[[...]]].
function nested(levels: number): unknown {
  let value: unknown = [];
  for (let i = 1; i < levels; i += 1) value = [value];
  return value;
}

describe('checkPlainJson', () => {
  it.each([
    ['no payload', undefined],
    ['null', null],
    ['a string', 'hi'],
    ['numbers', [0, -1.5, 1e21, Number.NaN, Number.POSITIVE_INFINITY]],
    ['booleans', [true, false]],
    ['a plain object', { text: 'hi', count: 2, tags: ['a', 'b'], nested: { ok: true } }],
    ['an object without a prototype', Object.assign(Object.create(null) as object, { a: 1 })],
    ['an object with an undefined field', { text: 'hi', skipped: undefined }],
    ['an array with holes', [1, , 3]], // eslint-disable-line no-sparse-arrays
  ])('accepts %s', (_label, value) => {
    expect(checkPlainJson(value, 1024)).toBe('ok');
  });

  it.each([
    ['a Uint8Array', new Uint8Array(4)],
    ['a typed array deep inside', { a: [{ b: new Float64Array(1) }] }],
    ['an ArrayBuffer', new ArrayBuffer(8)],
    ['a DataView', new DataView(new ArrayBuffer(8))],
    ['a Map', new Map()],
    ['a Set', new Set([1])],
    ['a Date', new Date(0)],
    ['a RegExp', /x/],
    ['an Error', new Error('x')],
    [
      'a class instance',
      new (class Point {
        x = 1;
      })(),
    ],
    ['a BigInt', { n: 1n }],
    ['a symbol', [Symbol('x')]],
    ['a function', { f: () => undefined }],
  ])('refuses %s as not plain', (_label, value) => {
    expect(checkPlainJson(value, 1024)).toBe('not_plain');
  });

  it('refuses a cycle instead of looping', () => {
    const cycle: Record<string, unknown> = {};
    cycle['self'] = cycle;
    expect(checkPlainJson(cycle, 64 * 1024)).toBe('not_plain');
  });

  it(`allows ${String(MAX_JSON_DEPTH)} levels of nesting and refuses one more`, () => {
    expect(checkPlainJson(nested(MAX_JSON_DEPTH), 1024)).toBe('ok');
    expect(checkPlainJson(nested(MAX_JSON_DEPTH + 1), 1024)).toBe('not_plain');
  });

  it('refuses deep nesting without overflowing the stack', () => {
    expect(checkPlainJson(nested(100_000), 1024 * 1024)).toBe('not_plain');
  });

  it('accepts exactly the limit and refuses one byte more', () => {
    const atLimit = 'x'.repeat(98); // 98 characters + 2 quotes = 100 bytes
    expect(jsonByteLength(atLimit)).toBe(100);
    expect(checkPlainJson(atLimit, 100)).toBe('ok');
    expect(checkPlainJson(`${atLimit}x`, 100)).toBe('too_large');
  });

  it.each([
    ['a long array', () => new Array<number>(1_000_000).fill(1)],
    ['a huge sparse array', () => new Array<unknown>(2 ** 31)],
    [
      'an object with many keys',
      () => Object.fromEntries(Array.from({ length: 50_000 }, (_, i) => [`k${String(i)}`, i])),
    ],
    ['one long string', () => 'x'.repeat(10 * 1024 * 1024)],
  ])('stops at the budget for %s', (_label, make) => {
    const value = make();
    const started = performance.now();
    expect(checkPlainJson(value, 64 * 1024)).toBe('too_large');
    // Loose bound: the walk is bounded by the budget; a full walk of these takes far longer.
    expect(performance.now() - started).toBeLessThan(500);
  });

  // Security review M1: undefined values add no JSON bytes, so only the step budget stops this.
  // Without it the gate said 'ok' and Zod then listed every key as unknown.
  it('counts keys with undefined values against the budget', () => {
    const keys = 100_000;
    const sparse = Object.fromEntries(
      Array.from({ length: keys }, (_, i) => [`k${String(i)}`, undefined]),
    );
    expect(jsonByteLength(sparse)).toBe(2); // "{}"
    expect(checkPlainJson(sparse, keys - 1)).toBe('too_large');
    expect(checkPlainJson(sparse, keys)).toBe('ok');
  });

  // The byte count must never exceed the real JSON size, or a valid payload could be refused
  // as too large. Escapes and non-ASCII characters make JSON longer than the estimate, never
  // shorter.
  it.each([
    ['ASCII text', { text: 'hello', list: [1, 2, 3] }],
    ['escapes', { text: 'quote " backslash \\ newline \n tab \t \u0001' }],
    ['non-ASCII', { name: 'Zoë 日本 🏰', [`ключ`]: 'значение' }],
    ['numbers', [0, -0, 1.5e-7, 123456789, Number.NaN, -Number.MAX_VALUE]],
    ['empty containers', { a: {}, b: [], c: [[]], d: '' }],
    ['undefined in arrays and objects', { a: [undefined, null], b: undefined }],
  ])('never counts more bytes than the real JSON (%s)', (_label, value) => {
    const exact = jsonByteLength(value);
    if (exact === undefined) throw new Error('fixture must be JSON');
    expect(checkPlainJson(value, exact)).toBe('ok');
  });
});
