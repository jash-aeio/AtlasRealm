// Turns the repositories' stable error codes into IPC command errors (ADR-0019).
// The repositories' own messages are not passed on: they are written for developers and may
// name tables. Each code gets one fixed, user-safe message instead.
import {
  RepositoryError,
  type RepositoryErrorCode,
} from '../storage/repositories/repository-support';
import { CommandError, type CommandErrorCode } from './router';

const MAPPING: Record<RepositoryErrorCode, { code: CommandErrorCode; message: string }> = {
  not_found: { code: 'not_found', message: 'That item does not exist in this profile.' },
  already_exists: { code: 'already_exists', message: 'That item already exists.' },
  invalid_input: { code: 'invalid_payload', message: 'Request rejected: invalid input.' },
  revision_conflict: {
    code: 'revision_conflict',
    message: 'This item changed since it was loaded. Reload it and try again.',
  },
  invalid_transition: {
    code: 'invalid_transition',
    message: 'That change is not possible in the current state.',
  },
};

/** Rethrows a RepositoryError as a CommandError; anything else is rethrown unchanged. */
export function toCommandError(error: unknown): unknown {
  if (!(error instanceof RepositoryError)) return error;
  const { code, message } = MAPPING[error.code];
  return new CommandError(code, message, error.currentRevision);
}

/** Runs `work`, translating repository errors on the way out. */
export function withRepositoryErrors<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    throw toCommandError(error);
  }
}
