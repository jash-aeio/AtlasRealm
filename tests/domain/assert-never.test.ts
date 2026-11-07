import { describe, expect, it } from 'vitest';

import { assertNever } from '../../src/common/errors/assert-never';

describe('assertNever', () => {
  it('throws when it is reached at runtime', () => {
    // A value from outside the type system (e.g. unvalidated data) can still get here.
    expect(() => assertNever('surprise' as never)).toThrow('Unexpected value: "surprise"');
    expect(() => assertNever('surprise' as never, 'Unknown run state')).toThrow(
      'Unknown run state: "surprise"',
    );
  });

  it('makes a forgotten switch case a compile error', () => {
    type Light = 'red' | 'green';

    function describeLight(light: Light): string {
      switch (light) {
        case 'red':
          return 'stop';
        default:
          // 'green' isn't handled, so `light` is 'green' here, not `never`.
          // @ts-expect-error: this line MUST be a type error; `pnpm typecheck` fails if it isn't.
          return assertNever(light);
      }
    }

    expect(describeLight('red')).toBe('stop');
    expect(() => describeLight('green')).toThrow('Unexpected value: "green"');
  });
});
