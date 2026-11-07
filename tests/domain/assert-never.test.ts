import { describe, it } from 'vitest';

// import { expect } from 'vitest';
// import { assertNever } from '../../src/common/errors/assert-never';

describe('assertNever', () => {
  // TODO(you): replace these two `it.todo` lines with real tests.
  //
  // Test 1: "throws when it is reached at runtime"
  //   - Values from outside the type system (e.g. bad data) can reach the default branch.
  //     Simulate that with a cast: `assertNever('surprise' as never)`.
  //   - Use `expect(() => ...).toThrow(...)`. Pass a string or regex to check the message
  //     includes the value. Look at how the message is built in assert-never.ts.
  //
  // Test 2: "makes a forgotten switch case a compile error"
  //   - Write a small union type, e.g. `type Light = 'red' | 'green'`, and a function
  //     with a `switch` that handles only 'red' and calls `assertNever(light)` in `default`.
  //   - Put `// @ts-expect-error` on the line above the assertNever call. That comment
  //     *requires* a type error on the next line: if TypeScript stops complaining,
  //     `pnpm typecheck` fails. So the test is really checked by the compiler.
  //   - At runtime, also assert that calling it with 'green' throws.
  //
  // Run `corepack pnpm test` (or `pnpm test`) to see them pass, and `pnpm typecheck` too.
  // Bonus: temporarily handle 'green' in the switch and watch typecheck fail. Why?
  it.todo('throws when it is reached at runtime');
  it.todo('makes a forgotten switch case a compile error');
});
