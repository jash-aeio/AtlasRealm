// Plain-language text for the hotbar (M2-10 #75). Every message about unpinning or replacing
// says that only the shortcut changes: the project or service itself is not affected
// (PRODUCT_RULES §3.1).
import type { IpcError } from '../../common/contracts/ipc-result';
import { entryText, slotKey, type HotbarEntry } from './hotbar-store';

/** Why a hotbar command did not work. The hotbar was read again before this is shown. */
export function hotbarProblem(error: IpcError): string {
  switch (error.code) {
    case 'already_exists':
      return 'That is already pinned to another slot. Unpin it there first.';
    case 'not_found':
      return 'That slot or project is no longer there. The hotbar was reloaded.';
    case 'revision_conflict':
    case 'slot_occupied':
      return 'That slot changed somewhere else. The hotbar was reloaded; check it and try again.';
    default:
      return error.message;
  }
}

export function pinnedText(name: string, slot: number): string {
  return `Pinned “${name}” to slot ${slotKey(slot)}. Press ${slotKey(slot)} to go to it.`;
}

export function unpinnedText(entry: HotbarEntry): string {
  const what = entry.target.type === 'project' ? 'The project itself' : 'The service itself';
  return `Unpinned “${entryText(entry)}” from slot ${slotKey(entry.slot)}. ${what} is not affected.`;
}

/** The confirmation before a filled slot is replaced (§22.2 #2). */
export const REPLACE_COPY = {
  title: (slot: number) => `Slot ${slotKey(slot)} is already in use`,
  holds: (occupant: HotbarEntry) =>
    `Slot ${slotKey(occupant.slot)} holds the shortcut “${entryText(occupant)}”.`,
  question: (occupant: HotbarEntry, name: string) =>
    `Replace it with “${name}”? Only the shortcut changes: “${entryText(occupant)}” itself is not affected.`,
  confirm: 'Replace',
} as const;
