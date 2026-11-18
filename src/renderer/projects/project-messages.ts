// Plain-language text for the project list (M1-10 #37): labels, goal checks, and what each
// lifecycle action does and does not do (PRD §5.6).
//
// Goals are checked with the same `ProjectGoal` rule as the IPC contract, so the user sees what
// is wrong before anything is sent. The main process checks again; this is only for clearer
// feedback, never the security boundary.
import type { IpcError } from '../../common/contracts/ipc-result';
import {
  PROJECT_GOAL_MAX_CHARS,
  ProjectGoal,
  type ProjectStatus,
} from '../../common/contracts/project';
import { commandProblem } from '../onboarding/form-messages';
import type { LifecycleAction } from './project-list';

/** Filter buttons. */
export const FILTER_LABELS: Record<ProjectStatus, string> = {
  active: 'Active',
  archived: 'Archived',
  trashed: 'Trash',
};

/** The word used in sentences such as "Showing 3 archived projects". */
export const FILTER_ADJECTIVES: Record<ProjectStatus, string> = {
  active: 'active',
  archived: 'archived',
  trashed: 'trashed',
};

/** A project's status as text, so it never depends on colour (UI_SPEC §6.5). */
export const STATUS_LABELS: Record<ProjectStatus, string> = {
  active: 'Active',
  archived: 'Archived',
  trashed: 'In trash',
};

/** Why a goal can't be used, or null when it's fine. An empty goal is allowed. */
export function goalProblem(goal: string): string | null {
  if (Array.from(goal.trim()).length > PROJECT_GOAL_MAX_CHARS) {
    return `Use at most ${String(PROJECT_GOAL_MAX_CHARS)} characters.`;
  }
  if (!ProjectGoal.safeParse(goal).success) return 'Remove invisible or control characters.';
  return null;
}

/** A message for a failed project command. */
export function projectCommandProblem(error: IpcError): string {
  if (error.code === 'revision_conflict') {
    return 'This project changed somewhere else. The list was reloaded with the latest version; check it and try again.';
  }
  if (error.code === 'not_found') {
    return 'This project is no longer here. The list was reloaded.';
  }
  return commandProblem(error, 'project');
}

export interface LifecycleCopy {
  /** The button that opens the confirmation. */
  readonly button: string;
  /** The dialog's title; `{name}` is filled in by the caller. */
  readonly title: (name: string) => string;
  readonly happens: readonly string[];
  readonly doesNotHappen: readonly string[];
  /** The confirm button in the dialog. */
  readonly confirm: string;
  /** Shown after it worked. */
  readonly done: (name: string) => string;
}

/**
 * The runs line for archive and trash. The main process answers `runCheck: 'stub'`: no run
 * runtime exists yet (M4), so nothing was checked or stopped, and the text must not claim it was.
 */
export const RUN_CHECK_STUB_NOTE =
  'No AI runs exist yet, so there was nothing to stop. Run handling arrives in a later update.';

export const LIFECYCLE_COPY: Record<LifecycleAction, LifecycleCopy> = {
  archive: {
    button: 'Archive',
    title: (name) => `Archive “${name}”?`,
    happens: ['The project moves from Active to Archived.', 'You can restore it at any time.'],
    doesNotHappen: [
      'Nothing is deleted: its name, goal and template are kept.',
      'No files are moved or deleted.',
      RUN_CHECK_STUB_NOTE,
    ],
    confirm: 'Archive project',
    done: (name) => `Archived “${name}”. Find it under Archived.`,
  },
  restore: {
    button: 'Restore',
    title: (name) => `Restore “${name}”?`,
    happens: ['The project moves from Archived back to Active.'],
    doesNotHappen: ['Nothing else changes: its name, goal and template stay as they are.'],
    confirm: 'Restore project',
    done: (name) => `Restored “${name}”. Find it under Active.`,
  },
  trash: {
    button: 'Move to trash',
    title: (name) => `Move “${name}” to the trash?`,
    happens: [
      'The project moves to Trash and can no longer be renamed or edited there.',
      'You can restore it from the trash at any time.',
    ],
    doesNotHappen: [
      'Nothing is permanently deleted: its name, goal and template are kept.',
      'No files are moved or deleted.',
      RUN_CHECK_STUB_NOTE,
    ],
    confirm: 'Move to trash',
    done: (name) => `Moved “${name}” to the trash. Find it under Trash.`,
  },
  restoreFromTrash: {
    button: 'Restore from trash',
    title: (name) => `Restore “${name}” from the trash?`,
    happens: [
      'The project goes back to where it was: Archived if it was archived before, otherwise Active.',
    ],
    doesNotHappen: ['Nothing else changes: its name, goal and template stay as they are.'],
    confirm: 'Restore project',
    done: (name) => `Restored “${name}” from the trash.`,
  },
};

/** Which lifecycle actions a project in this status offers. */
export const ACTIONS_FOR_STATUS: Record<ProjectStatus, readonly LifecycleAction[]> = {
  active: ['archive', 'trash'],
  archived: ['restore', 'trash'],
  trashed: ['restoreFromTrash'],
};
