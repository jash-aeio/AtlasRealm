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
