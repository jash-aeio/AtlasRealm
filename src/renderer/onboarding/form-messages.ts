// Plain-language messages for the onboarding and settings forms.
//
// Names are checked here with the same `DisplayName` rule the IPC contract uses, so the user
// sees what is wrong before anything is sent. The main process checks again; this is only
// for clearer feedback, never the security boundary.
import { DISPLAY_NAME_MAX_CHARS, DisplayName } from '../../common/contracts/display-name';
import type { IpcError } from '../../common/contracts/ipc-result';

/** Why a name can't be used, or null when it's fine. */
export function nameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'Enter a name.';
  if (Array.from(trimmed).length > DISPLAY_NAME_MAX_CHARS) {
    return `Use at most ${String(DISPLAY_NAME_MAX_CHARS)} characters.`;
  }
  if (!DisplayName.safeParse(name).success) {
    return 'Remove line breaks and invisible or control characters.';
  }
  return null;
}

/** A message for a failed command. `thing` names what was being saved, e.g. "profile". */
export function commandProblem(error: IpcError, thing: string): string {
  switch (error.code) {
    case 'already_exists':
      return `A ${thing} with that name already exists. Pick another name.`;
    case 'limit_reached':
      return `You've reached the maximum number of ${thing}s.`;
    case 'revision_conflict':
      return 'This changed somewhere else. The latest version is shown; try again.';
    default:
      return error.message;
  }
}
