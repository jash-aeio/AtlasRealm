// The renderer's copy of one world's hotbar (M2-10 #75, UI_SPEC §6.1): what `hotbar.list`
// last returned, with the pinned projects' names read through `project.get`.
//
// Like the placements store it is a cache, never the source of truth. Pinning and unpinning go
// through the main process, which refuses to overwrite a filled slot unless the caller names
// the shortcut it expects to replace (ADR-0026). This store turns those answers into plain
// outcomes for the UI: pinned, occupied (with the real occupant, so the UI can ask before
// replacing), or failed. A slot is only a shortcut: nothing here changes a project.
//
// Pure TypeScript with no React or DOM imports: the API is passed in, so it's unit-tested
// with a fake.
import type { AtlasApi } from '../../common/contracts/atlas-api';
import type { HotbarSlotSummary, HotbarTarget } from '../../common/contracts/hotbar';
import type { IpcError } from '../../common/contracts/ipc-result';
import type { ProjectStatus } from '../../common/contracts/project';
import { isServiceKind, type ServiceKind } from '../../common/world/service-kinds';
import { ENTRANCES, type EntranceId } from '../app/entrances';
import { createStore, type Store } from '../state/store';

export interface HotbarApi {
  readonly hotbar: AtlasApi['hotbar'];
  readonly project: Pick<AtlasApi['project'], 'get'>;
}

/** One filled slot, ready to show. */
export interface HotbarEntry {
  readonly slot: number;
  readonly target: HotbarTarget;
  /** The pinned project's status; null for a service. */
  readonly projectStatus: ProjectStatus | null;
  /** The project's or service's name; null when the project could not be read. */
  readonly name: string | null;
}

export interface HotbarState {
  /** `loading` until the first answer; later refreshes keep the last good slots on screen. */
  readonly status: 'loading' | 'ready' | 'error';
  /** Filled slots only, by slot number. */
  readonly entries: readonly HotbarEntry[];
  /** Why the last read failed, or null. */
  readonly error: IpcError | null;
}

export type PinOutcome =
  | { readonly kind: 'pinned'; readonly slot: number }
  /** The slot holds something else; nothing was written. Ask, then pin with `replace`. */
  | { readonly kind: 'occupied'; readonly occupant: HotbarEntry }
  | { readonly kind: 'failed'; readonly error: IpcError };

export type UnpinOutcome =
  | { readonly ok: true; readonly entry: HotbarEntry }
  | { readonly ok: false; readonly error: IpcError };

export interface Hotbar {
  readonly store: Store<HotbarState>;
  /** Reads the hotbar again. Answers that arrive after a newer request started are ignored. */
  readonly refresh: () => Promise<void>;
  /**
   * Pins `target` to `slot`. Without `replaceId` an occupied slot is refused as `occupied`;
   * with it, the slot is replaced only if it still holds that target.
   */
  readonly pin: (slot: number, target: HotbarTarget, replaceId?: string) => Promise<PinOutcome>;
  /** Empties `slot` if it still holds `expectedTargetId`. The target itself is untouched. */
  readonly unpin: (slot: number, expectedTargetId: string) => Promise<UnpinOutcome>;
}

/** Slot 0 is key `1` … slot 8 is key `9`, slot 9 is key `0` (UI_SPEC §6.1). */
export function slotKey(slot: number): string {
  return String((slot + 1) % 10);
}

/** The sidebar entrance each service kind stands for: activating its slot opens that panel. */
export const SERVICE_ENTRANCES: Readonly<Record<ServiceKind, EntranceId>> = {
  'agents-guild': 'agents',
  'skill-library': 'skills',
  'tool-shops': 'tools',
  automations: 'automations',
  activity: 'activity',
  settings: 'settings',
};

/** The service kind an entrance can be pinned as, or undefined (Projects is not a service). */
export function serviceOfEntrance(entrance: EntranceId): ServiceKind | undefined {
  return (Object.keys(SERVICE_ENTRANCES) as ServiceKind[]).find(
    (kind) => SERVICE_ENTRANCES[kind] === entrance,
  );
}

export function serviceName(kind: ServiceKind): string {
  const entrance = SERVICE_ENTRANCES[kind];
  return ENTRANCES.find((e) => e.id === entrance)?.label ?? kind;
}

/**
 * What a slot says in text: the name, plus the status of an archived or trashed project
 * ("Garden (archived)"), so the state never depends on colour (UI_SPEC §6.5).
 */
export function entryText(entry: HotbarEntry): string {
  const name =
    entry.name ?? (entry.target.type === 'project' ? 'Unknown project' : entry.target.id);
  if (entry.projectStatus === 'archived') return `${name} (archived)`;
  if (entry.projectStatus === 'trashed') return `${name} (in trash)`;
  return name;
}

export function entryOf(state: HotbarState, slot: number): HotbarEntry | undefined {
  return state.entries.find((entry) => entry.slot === slot);
}

/** The slot a target is pinned to, or undefined. Each target is pinned at most once. */
export function slotOfTarget(state: HotbarState, targetId: string): HotbarEntry | undefined {
  return state.entries.find((entry) => entry.target.id === targetId);
}

export function createHotbar(api: HotbarApi, worldId: string): Hotbar {
  const store = createStore<HotbarState>({ status: 'loading', entries: [], error: null });
  let latest = 0;

  async function nameOf(target: HotbarTarget): Promise<string | null> {
    if (target.type === 'service') return serviceName(target.id);
    const result = await api.project.get({ worldId, projectId: target.id });
    return result.ok ? result.data.project.name : null;
  }

  async function toEntry(
    slot: number,
    target: HotbarTarget,
    projectStatus: ProjectStatus | null,
  ): Promise<HotbarEntry> {
    return { slot, target, projectStatus, name: await nameOf(target) };
  }

  async function refresh(): Promise<void> {
    const request = ++latest;
    const result = await api.hotbar.list({ worldId });
    if (request !== latest) return;
    if (!result.ok) {
      // Keep showing the slots we already had; the error is shown next to them.
      const current = store.get();
      store.set({
        status: current.status === 'loading' ? 'error' : current.status,
        entries: current.entries,
        error: result.error,
      });
      return;
    }
    // At most ten small reads, in parallel.
    const entries = await Promise.all(
      result.data.slots.map((s: HotbarSlotSummary) => toEntry(s.slot, s.target, s.projectStatus)),
    );
    if (request !== latest) return;
    store.set({ status: 'ready', entries, error: null });
  }

  return {
    store,
    refresh,
    async pin(slot, target, replaceId) {
      const result = await api.hotbar.assign({
        worldId,
        slot,
        target,
        ...(replaceId === undefined ? {} : { replace: { expectedTargetId: replaceId } }),
      });
      if (result.ok) {
        await refresh();
        return { kind: 'pinned', slot: result.data.slot.slot };
      }
      const conflict = result.error.hotbar;
      if (result.error.code === 'slot_occupied' && conflict !== undefined) {
        // The slot changed since it was shown (or was never empty): show it as it is now.
        void refresh();
        const { target: occupied, projectStatus } = conflict.occupant;
        const occupant: HotbarTarget =
          occupied.type === 'service' && isServiceKind(occupied.id)
            ? { type: 'service', id: occupied.id }
            : { type: 'project', id: occupied.id };
        return {
          kind: 'occupied',
          occupant: await toEntry(conflict.slot, occupant, projectStatus),
        };
      }
      return { kind: 'failed', error: result.error };
    },
    async unpin(slot, expectedTargetId) {
      const result = await api.hotbar.clear({ worldId, slot, expectedTargetId });
      // Read again either way: a refusal means the slot differs from what was shown.
      await refresh();
      if (!result.ok) return { ok: false, error: result.error };
      const cleared = result.data.slot;
      return {
        ok: true,
        entry: await toEntry(cleared.slot, cleared.target, cleared.projectStatus),
      };
    },
  };
}
