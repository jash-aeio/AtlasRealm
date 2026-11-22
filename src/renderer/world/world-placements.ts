// The renderer's copy of one world's buildings (M2-6 #71): what `placement.list` last returned.
//
// Like the project list it is a cache, never the source of truth: the world view draws it and
// the Projects panel reads it to mark projects "Not placed". Anything that may have changed the
// buildings (archiving a project removes its building, ADR-0025) calls `refresh`.
//
// Pure TypeScript with no React or DOM imports: the API is passed in, so it's unit-tested
// with a fake.
import type { AtlasApi } from '../../common/contracts/atlas-api';
import type { IpcError } from '../../common/contracts/ipc-result';
import type { PlacementSummary } from '../../common/contracts/placement';
import { createStore, type Store } from '../state/store';

export interface WorldPlacementsApi {
  readonly placement: Pick<AtlasApi['placement'], 'list'>;
}

export interface WorldPlacementsState {
  /** `loading` until the first answer; later refreshes keep the last good list on screen. */
  readonly status: 'loading' | 'ready' | 'error';
  readonly placements: readonly PlacementSummary[];
  /** Why the last read failed, or null. */
  readonly error: IpcError | null;
}

export interface WorldPlacements {
  readonly store: Store<WorldPlacementsState>;
  /** Reads the list again. Answers that arrive after a newer request started are ignored. */
  readonly refresh: () => Promise<void>;
}

/** The IDs of the projects that have a building, for "Not placed" labels. */
export function placedProjectIds(state: WorldPlacementsState): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const placement of state.placements) {
    if (placement.target.type === 'project') ids.add(placement.target.id);
  }
  return ids;
}

export function createWorldPlacements(api: WorldPlacementsApi, worldId: string): WorldPlacements {
  const store = createStore<WorldPlacementsState>({
    status: 'loading',
    placements: [],
    error: null,
  });
  let latest = 0;

  return {
    store,
    async refresh() {
      const request = ++latest;
      const result = await api.placement.list({ worldId });
      if (request !== latest) return;
      const current = store.get();
      if (result.ok) {
        store.set({ status: 'ready', placements: result.data.placements, error: null });
      } else {
        // Keep showing the buildings we already had; the error is shown next to them.
        store.set({
          status: current.status === 'loading' ? 'error' : current.status,
          placements: current.placements,
          error: result.error,
        });
      }
    },
  };
}

/** The building that represents a project, or undefined when it is not placed. */
export function placementOf(
  state: WorldPlacementsState,
  projectId: string,
): PlacementSummary | undefined {
  return state.placements.find(
    (placement) => placement.target.type === 'project' && placement.target.id === projectId,
  );
}

/** "Building at tile 10, 4", or "Not placed" (the project is still fully usable). */
export function placementText(placement: PlacementSummary | undefined): string {
  return placement === undefined
    ? 'Not placed'
    : `Building at tile ${String(placement.tileX)}, ${String(placement.tileY)}`;
}
