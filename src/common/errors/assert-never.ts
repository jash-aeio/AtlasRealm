/**
 * Marks code that must be unreachable when every case of a union has been handled.
 *
 * Put it in the `default` branch of a `switch` over a union type. If someone later adds
 * a new member to the union (for example a new run state) and forgets to handle it,
 * the value is no longer `never` and the build fails right here, instead of
 * the case being silently ignored at runtime.
 *
 * At runtime it throws, as a last-resort guard for values that bypassed the type
 * system (e.g. unvalidated data).
 */
export function assertNever(value: never, message = 'Unexpected value'): never {
  throw new Error(`${message}: ${JSON.stringify(value)}`);
}
