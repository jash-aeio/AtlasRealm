import { describe, expect, it } from 'vitest';

import { toCommandError, withRepositoryErrors } from '../../src/main/ipc/repository-errors';
import { CommandError } from '../../src/main/ipc/router';
import { RepositoryError } from '../../src/main/storage/repositories/repository-support';

describe('repository errors at the IPC boundary', () => {
  it.each([
    ['not_found', 'not_found'],
    ['already_exists', 'already_exists'],
    ['invalid_input', 'invalid_payload'],
    ['revision_conflict', 'revision_conflict'],
    ['invalid_transition', 'invalid_transition'],
  ] as const)('maps %s to %s with a fixed message', (from, to) => {
    const mapped = toCommandError(new RepositoryError(from, 'No worlds record with that ID.'));
    expect(mapped).toBeInstanceOf(CommandError);
    expect(mapped).toMatchObject({ code: to });
    // The developer message (which names a table) is never passed on.
    expect((mapped as CommandError).message).not.toContain('worlds');
  });

  it('keeps the current revision of a conflict', () => {
    const mapped = toCommandError(new RepositoryError('revision_conflict', 'stale', 4));
    expect(mapped).toMatchObject({ code: 'revision_conflict', currentRevision: 4 });
  });

  it('leaves other errors alone, so they still become internal_error', () => {
    const bug = new TypeError('boom');
    expect(toCommandError(bug)).toBe(bug);
    expect(() =>
      withRepositoryErrors(() => {
        throw bug;
      }),
    ).toThrow(bug);
  });
});
