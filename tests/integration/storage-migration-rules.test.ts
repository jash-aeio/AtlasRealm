import { describe, expect, it } from 'vitest';

import { assertMigrationsAreValid, type Migration } from '../../src/main/storage/migration-rules';

const m = (version: number, name = `m${String(version)}`): Migration => ({
  version,
  name,
  up: 'SELECT 1;',
});

// TODO(you): remove `.skip` once you start implementing assertMigrationsAreValid.
describe.skip('assertMigrationsAreValid', () => {
  it.each([
    ['an empty list', []],
    ['one migration', [m(1)]],
    ['a contiguous list', [m(1), m(2), m(3)]],
  ])('accepts %s', (_label, list) => {
    expect(() => {
      assertMigrationsAreValid(list);
    }).not.toThrow();
  });

  it.each([
    ['not starting at 1', [m(2), m(3)]],
    ['a gap', [m(1), m(3)]],
    ['a duplicate', [m(1), m(1)]],
    ['wrong order', [m(2), m(1)]],
    ['a fractional version', [m(1), m(1.5)]],
  ])('rejects %s', (_label, list) => {
    expect(() => {
      assertMigrationsAreValid(list);
    }).toThrow();
  });

  it('names the offending migration in the error', () => {
    expect(() => {
      assertMigrationsAreValid([m(1), m(3, 'add_things')]);
    }).toThrow(/add_things/);
  });
});
