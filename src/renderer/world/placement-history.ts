// Undo and redo for placement changes (M2-8 #73, UI_SPEC §17.2).
//
// The command pattern: every place, move or remove the placement tool saved is kept as an entry
// that knows how to send its *inverse* (remove what was placed, move back, place again what was
// removed) and how to send itself again. Undo sends the inverse of the newest entry; redo sends
// the entry again. Each is an ordinary placement command, so the main process checks it like any
// other: with the revision this history expects, and the shared placement rules. When it refuses
// (the building changed elsewhere, the old spot is taken now, the project is gone), the entry is
// dropped with a message. Nothing is retried or forced (PRODUCT_RULES §3.1).
//
// Only placement changes are ever recorded. Archiving or trashing a project also removes its
// building, but that is a project operation and is never recorded, so undo can never touch a
// project, a file or a run.
//
// The history lives in memory for one world in one profile: MainScreen makes a new one when
// either changes, so it starts empty. It is never saved.
//
// Pure TypeScript with no React, DOM or Pixi imports, unit-tested with a fake API
// (tests/domain/placement-history.test.ts).
import type { AtlasApi } from '../../common/contracts/atlas-api';
import type { IpcError, IpcResult } from '../../common/contracts/ipc-result';
import type { PlacementOutput, PlacementSummary } from '../../common/contracts/placement';
import type { PlacementRotation } from '../../common/world/placement-rules';
import { createStore, type Store } from '../state/store';
import type {
  PlacementChange,
  PlacementRecorder,
  ToolMessage,
  ToolProject,
  ToolWorld,
} from './placement-tool';
import type { WorldPlacements } from './world-placements';

export interface PlacementHistoryApi {
  readonly placement: Pick<AtlasApi['placement'], 'create' | 'move' | 'remove'>;
}

/** The oldest entries are forgotten beyond this. */
export const MAX_HISTORY = 50;

/** One saved building version: its ID and the revision the main process gave it. */
interface Version {
  readonly placementId: string;
  readonly revision: number;
}

interface Spot {
  readonly tileX: number;
  readonly tileY: number;
  readonly rotation: PlacementRotation;
}

/**
 * One recorded change. `before` and `after` are the building versions on either side of it
 * (none before a place, none after a remove); undo expects `after`, redo expects `before`.
 */
type Entry =
  | { readonly kind: 'place'; readonly project: ToolProject; readonly spot: Spot; after: Version }
  | {
      readonly kind: 'move';
      readonly project: ToolProject;
      readonly from: Spot;
      readonly to: Spot;
      before: Version;
      after: Version;
    }
  | {
      readonly kind: 'remove';
      readonly project: ToolProject;
      readonly spot: Spot;
      before: Version;
    };

export interface PlacementHistoryState {
  /** What Undo would do, e.g. `move “Alpha”`, or null when there is nothing to undo. */
  readonly undoLabel: string | null;
  readonly redoLabel: string | null;
  /** True while an undo or redo is on its way; further ones are ignored meanwhile. */
  readonly busy: boolean;
  /** What the last undo or redo did, or null. */
  readonly message: ToolMessage | null;
}

export interface PlacementHistory extends PlacementRecorder {
  readonly store: Store<PlacementHistoryState>;
  /** Reverses the newest change. Returns what happened, or null when there was nothing to do. */
  readonly undo: () => Promise<ToolMessage | null>;
  /** Does the most recently undone change again. */
  readonly redo: () => Promise<ToolMessage | null>;
  /** Forgets every entry. */
  readonly clear: () => void;
  readonly dismissMessage: () => void;
}

/** Said when an undo or redo got no answer at all. The entry is dropped, never resent. */
export const HISTORY_UNKNOWN_OUTCOME =
  'Not sure it was saved: the app got no answer. That step was dropped and will not be sent again. The map was reloaded; check it.';

/** A short name for an entry, used on the buttons and in messages. */
export function entryLabel(entry: Pick<Entry, 'kind' | 'project'>): string {
  switch (entry.kind) {
    case 'place':
      return `place “${entry.project.name}”`;
    case 'move':
      return `move “${entry.project.name}”`;
    case 'remove':
      return `remove “${entry.project.name}” from the map`;
  }
}

const tileText = (spot: { readonly tileX: number; readonly tileY: number }): string =>
  `tile ${String(spot.tileX)}, ${String(spot.tileY)}`;

const versionOf = (placement: PlacementSummary): Version => ({
  placementId: placement.id,
  revision: placement.revision,
});

const spotOf = (placement: PlacementSummary): Spot => ({
  tileX: placement.tileX,
  tileY: placement.tileY,
  rotation: placement.rotation,
});

const sameVersion = (a: Version, b: Version): boolean =>
  a.placementId === b.placementId && a.revision === b.revision;

function entryOf(change: PlacementChange): Entry {
  switch (change.kind) {
    case 'placed':
      return {
        kind: 'place',
        project: change.project,
        spot: spotOf(change.placement),
        after: versionOf(change.placement),
      };
    case 'moved':
      return {
        kind: 'move',
        project: change.project,
        from: spotOf(change.before),
        to: spotOf(change.after),
        before: versionOf(change.before),
        after: versionOf(change.after),
      };
    case 'removed':
      return {
        kind: 'remove',
        project: change.project,
        spot: spotOf(change.placement),
        before: versionOf(change.placement),
      };
  }
}

/** Why an undo or redo was refused, in plain words. The step is always dropped. */
export function historyProblem(action: 'undo' | 'redo', label: string, error: IpcError): string {
  const reason = ((): string => {
    switch (error.code) {
      case 'revision_conflict':
        return 'this building changed since then';
      case 'placement_blocked':
        return error.placement?.reason === 'overlaps'
          ? 'another building stands there now'
          : 'the building cannot stand there now';
      case 'not_found':
        return 'the building or its project is no longer here';
      case 'already_exists':
        return 'the project has another building now';
      case 'invalid_transition':
        return error.message;
      default:
        return `${error.message} (${error.code})`;
    }
  })();
  return `Couldn't ${action} ${label}: ${reason}. That step was dropped; nothing was changed or forced.`;
}

const EMPTY: PlacementHistoryState = {
  undoLabel: null,
  redoLabel: null,
  busy: false,
  message: null,
};

/** What one undo or redo produced: the building version in the answer, a refusal, or no answer. */
type Outcome =
  | { readonly ok: true; readonly version: Version }
  | { readonly ok: false; readonly error: IpcError }
  | null;

export function createPlacementHistory(
  api: PlacementHistoryApi,
  world: ToolWorld,
  placements: WorldPlacements,
): PlacementHistory {
  const store = createStore<PlacementHistoryState>(EMPTY);
  // Newest last in both.
  const undoStack: Entry[] = [];
  const redoStack: Entry[] = [];
  let busy = false;

  function publish(message: ToolMessage | null): void {
    const undoTop = undoStack.at(-1);
    const redoTop = redoStack.at(-1);
    store.set({
      undoLabel: undoTop === undefined ? null : entryLabel(undoTop),
      redoLabel: redoTop === undefined ? null : entryLabel(redoTop),
      busy,
      message,
    });
  }

  /**
   * Undoing a remove places the building again under a new ID, and every change raises the
   * revision. Entries that expected the old version now expect the new one, so the rest of the
   * history still lines up (otherwise the next undo would see a false conflict).
   */
  function replaceVersion(old: Version, next: Version, current: Entry): void {
    // `current` is the entry being undone or redone: it is on neither stack just now.
    for (const entry of [current, ...undoStack, ...redoStack]) {
      if (entry.kind !== 'place' && sameVersion(entry.before, old)) entry.before = next;
      if (entry.kind !== 'remove' && sameVersion(entry.after, old)) entry.after = next;
    }
  }

  /** Sends one command and reloads the buildings either way. null means no answer at all. */
  async function send(call: () => Promise<IpcResult<PlacementOutput>>): Promise<Outcome> {
    let outcome: Outcome = null;
    try {
      const result = await call();
      outcome = result.ok
        ? { ok: true, version: versionOf(result.data.placement) }
        : { ok: false, error: result.error };
    } catch (error) {
      console.error('[placement-history] command got no answer', error);
    }
    try {
      await placements.refresh();
    } catch (error) {
      console.error('[placement-history] could not reload the buildings', error);
    }
    return outcome;
  }

  const create = (entry: Entry & { spot: Spot }) => () =>
    api.placement.create({ worldId: world.id, projectId: entry.project.id, ...entry.spot });
  const remove = (version: Version) => () =>
    api.placement.remove({
      worldId: world.id,
      placementId: version.placementId,
      expectedRevision: version.revision,
    });
  const move = (version: Version, spot: Spot) => () =>
    api.placement.move({
      worldId: world.id,
      placementId: version.placementId,
      expectedRevision: version.revision,
      ...spot,
    });

  /** The command that reverses an entry, and the version its success replaces. */
  function inverse(entry: Entry) {
    switch (entry.kind) {
      case 'place':
        return { call: remove(entry.after), replaces: null };
      case 'move':
        return { call: move(entry.after, entry.from), replaces: entry.before };
      case 'remove':
        return { call: create(entry), replaces: entry.before };
    }
  }

  /** The command that does an entry again, and the version its success replaces. */
  function forward(entry: Entry) {
    switch (entry.kind) {
      case 'place':
        return { call: create(entry), replaces: entry.after };
      case 'move':
        return { call: move(entry.before, entry.to), replaces: entry.after };
      case 'remove':
        return { call: remove(entry.before), replaces: null };
    }
  }

  function doneText(action: 'undo' | 'redo', entry: Entry): string {
    const name = `“${entry.project.name}”`;
    if (action === 'undo') {
      switch (entry.kind) {
        case 'place':
          return `Undone: the building of ${name} was removed from the map again. The project is kept and shows as Not placed.`;
        case 'move':
          return `Undone: ${name} is back at ${tileText(entry.from)}.`;
        case 'remove':
          return `Undone: ${name} is back on the map at ${tileText(entry.spot)}.`;
      }
    }
    switch (entry.kind) {
      case 'place':
        return `Redone: ${name} is on the map again at ${tileText(entry.spot)}.`;
      case 'move':
        return `Redone: ${name} moved to ${tileText(entry.to)} again.`;
      case 'remove':
        return `Redone: the building of ${name} was removed from the map again. The project is kept and shows as Not placed.`;
    }
  }

  async function step(action: 'undo' | 'redo'): Promise<ToolMessage | null> {
    if (busy) return null;
    const from = action === 'undo' ? undoStack : redoStack;
    const to = action === 'undo' ? redoStack : undoStack;
    const entry = from.pop();
    if (entry === undefined) return null;
    busy = true;
    publish(null);
    const { call, replaces } = action === 'undo' ? inverse(entry) : forward(entry);
    const outcome = await send(call);
    busy = false;

    let message: ToolMessage;
    if (outcome === null) {
      message = { ok: false, text: HISTORY_UNKNOWN_OUTCOME };
    } else if (!outcome.ok) {
      message = { ok: false, text: historyProblem(action, entryLabel(entry), outcome.error) };
    } else {
      // A remove has nothing to replace: its answer is the building that is gone now.
      if (replaces !== null) replaceVersion(replaces, outcome.version, entry);
      to.push(entry);
      message = { ok: true, text: doneText(action, entry) };
    }
    publish(message);
    return message;
  }

  return {
    store,
    record(change) {
      undoStack.push(entryOf(change));
      if (undoStack.length > MAX_HISTORY) undoStack.shift();
      // A new change makes the undone ones meaningless: they can't be redone any more.
      redoStack.length = 0;
      // The tool shows its own message for the change; drop an old undo message.
      publish(null);
    },
    isBusy: () => busy,
    undo: () => step('undo'),
    redo: () => step('redo'),
    clear() {
      undoStack.length = 0;
      redoStack.length = 0;
      publish(null);
    },
    dismissMessage() {
      const current = store.get();
      if (current.message !== null) store.set({ ...current, message: null });
    },
  };
}
