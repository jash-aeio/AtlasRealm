// Message size, measured the same way at every process boundary (IPC and worker): the UTF-8
// length of the value's JSON text. Structured clone can carry more than JSON (Maps, typed
// arrays, BigInt), but our contracts are plain data, so anything JSON can't encode is refused.

// TextEncoder rather than Buffer: src/common also compiles for the renderer, which has no Node.
const utf8 = new TextEncoder();

/**
 * Returns the UTF-8 byte length of `JSON.stringify(value)`, 0 for `undefined` (no argument),
 * or `undefined` when the value isn't plain JSON data (BigInt, cycles).
 */
export function jsonByteLength(value: unknown): number | undefined {
  // JSON.stringify(undefined) returns undefined, despite its types.
  if (value === undefined) return 0;
  try {
    return utf8.encode(JSON.stringify(value)).byteLength;
  } catch {
    return undefined;
  }
}

/** Deepest nesting a payload may have. Our contracts nest a few levels; this also stops cycles. */
export const MAX_JSON_DEPTH = 64;

export type PlainJsonCheck = 'ok' | 'not_plain' | 'too_large';

/**
 * A cheap gate for untrusted input, run before schema validation. It walks the value once and
 * stops at the first problem:
 * - `not_plain`: something JSON can't carry as-is: typed arrays, ArrayBuffer, Map, Set, Date,
 *   class instances, BigInt, symbols, functions, or nesting deeper than MAX_JSON_DEPTH (cycles).
 * - `too_large`: the JSON text would be longer than `maxBytes`.
 *
 * The byte count is a lower bound of jsonByteLength (escapes and non-ASCII characters only add
 * bytes), so `too_large` from bytes is never wrong. Every object key and array slot visited
 * also counts as one step, and more than `maxBytes` steps is `too_large` too: keys whose value
 * is `undefined` add no JSON bytes, but a million of them would still cost a million visits here
 * and in Zod (#56 security review M1). So the walk stops after about `maxBytes` visits. Listing
 * a huge object's keys is still proportional to its key count (no JavaScript API lists own keys
 * lazily), which stays below the structured-clone cost the receiver has already paid.
 * A value that passes still needs jsonByteLength for the exact size.
 *
 * Why this exists: Zod's object check accepts a typed array as an "object" and then lists every
 * index as an unknown key, which takes seconds for a 10 MB Uint8Array.
 */
export function checkPlainJson(value: unknown, maxBytes: number): PlainJsonCheck {
  if (value === undefined) return 'ok';
  let bytes = 0;
  let steps = 0;
  let result: PlainJsonCheck = 'ok';

  const add = (n: number): boolean => {
    bytes += n;
    if (bytes > maxBytes) result = 'too_large';
    return result === 'ok';
  };
  const step = (): boolean => {
    steps += 1;
    if (steps > maxBytes) result = 'too_large';
    return result === 'ok';
  };
  const refuse = (): false => {
    result = 'not_plain';
    return false;
  };

  // Returns false to stop the walk; `result` then says why.
  const visit = (item: unknown, depth: number): boolean => {
    switch (typeof item) {
      case 'string':
        return add(item.length + 2);
      case 'number':
        return add(Number.isFinite(item) ? String(item).length : 4);
      case 'boolean':
        return add(item ? 4 : 5);
      case 'undefined':
        return add(4); // only reached inside arrays, where JSON writes null
      case 'object':
        break;
      default:
        return refuse(); // bigint, symbol, function
    }
    if (item === null) return add(4);
    if (depth >= MAX_JSON_DEPTH) return refuse();

    if (Array.isArray(item)) {
      if (!add(2)) return false;
      for (let i = 0; i < item.length; i += 1) {
        if (!step()) return false;
        if (i > 0 && !add(1)) return false;
        if (!visit(item[i], depth + 1)) return false;
      }
      return true;
    }

    const proto: unknown = Object.getPrototypeOf(item);
    if (proto !== Object.prototype && proto !== null) return refuse();
    if (!add(2)) return false;
    let first = true;
    const record = item as Record<string, unknown>;
    // Only plain objects get here, so Object.keys (own, enumerable, string keys) is exactly what
    // JSON.stringify would write.
    for (const key of Object.keys(record)) {
      if (!step()) return false;
      const child = record[key];
      if (child === undefined) continue; // JSON drops the key
      if (!first && !add(1)) return false;
      first = false;
      if (!add(key.length + 3)) return false; // "key":
      if (!visit(child, depth + 1)) return false;
    }
    return true;
  };

  visit(value, 0);
  return result;
}
