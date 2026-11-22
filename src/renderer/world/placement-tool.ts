// The placement tool (M2-7 #72, UI_SPEC §6.2, §17.2): place a project's building, move one,
// remove one, or let auto-place find a free plot.
//
// A small state machine: `idle` → `placing` (a new building for a project) or `moving` (an
// existing building) → back to `idle` when the change is saved or the user cancels. Only the
// tool's own state lives here. The buildings come from the placements store, and the preview is
// worked out from both with the shared placement rules (M2-1), so it can't disagree with the
// check the command runs. The command is still the judge (PRODUCT_RULES §3.1): when it refuses,
// the message is shown and nothing changes.
//
// Decisions (user, 2026-11-22): an invalid drop leaves the building where it is saved; Auto-place
// saves straight away and says where.
//
// Pure TypeScript with no React, DOM or Pixi imports: the API is passed in, so the whole tool is
// unit-tested with a fake (tests/domain/placement-tool.test.ts).
import type { AtlasApi } from '../../common/contracts/atlas-api';
import type { IpcError, IpcResult, PlacementRefusal } from '../../common/contracts/ipc-result';
import type { PlacementSummary } from '../../common/contracts/placement';
import {
  checkPlacement,
  findNearbyPlot,
  rotatedFootprint,
  type Footprint,
  type OccupiedPlacement,
  type PlacementCheck,
  type PlacementRotation,
  type PlacementWorld,
  type Tile,
} from '../../common/world/placement-rules';
import { createStore, type Store } from '../state/store';
import { placementOf, type WorldPlacements } from './world-placements';

export interface PlacementToolApi {
  readonly placement: Pick<AtlasApi['placement'], 'create' | 'move' | 'remove'>;
}

/** The project a command is about. The name is only for messages. */
export interface ToolProject {
  readonly id: string;
  readonly name: string;
}

export type ToolMode =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'placing';
      readonly project: ToolProject;
      readonly footprint: Footprint;
      readonly rotation: PlacementRotation;
    }
  | {
      readonly kind: 'moving';
      readonly project: ToolProject;
      readonly placementId: string;
      readonly footprint: Footprint;
      readonly rotation: PlacementRotation;
      /** Where it is saved now: an invalid drop leaves it here. */
      readonly origin: Tile;
    };

export interface ToolMessage {
  readonly ok: boolean;
  readonly text: string;
}

export interface PlacementToolState {
  readonly mode: ToolMode;
  /** The preview's anchor (north corner tile, ADR-0024), or null when idle. */
  readonly anchor: Tile | null;
  /** True while a command is on its way; further commits are ignored meanwhile. */
  readonly busy: boolean;
  /** What the last action did, or null. */
  readonly message: ToolMessage | null;
}

/** What the preview shows: the spot, whether it fits and a text label for it. */
export interface PlacementPreview {
  readonly anchor: Tile;
  readonly footprint: Footprint;
  readonly rotation: PlacementRotation;
  readonly check: PlacementCheck;
  /** Text that goes with the green/red markers, so colour is never the only signal (§6.5). */
  readonly label: string;
  /** The building being moved, drawn faded at its saved spot meanwhile. */
  readonly movingPlacementId: string | null;
}

export interface PlacementTool {
  readonly store: Store<PlacementToolState>;
  /** Starts placing a new building for a project. The preview starts on the nearest free plot. */
  readonly startPlacing: (project: ToolProject) => void;
  /** Starts moving the project's building. Says so when the project has none. */
  readonly startMoving: (project: ToolProject) => void;
  /** Puts the preview under the pointer's tile (the pointer sits on the footprint's middle). */
  readonly pointAt: (tile: { readonly gx: number; readonly gy: number }) => void;
  /** Moves the preview by whole tiles (arrow keys), keeping the footprint on the map. */
  readonly nudge: (dx: number, dy: number) => void;
  /** Saves the building at the preview. Refused locally when the preview says it can't stand. */
  readonly commit: () => Promise<ToolMessage | null>;
  /** Places the project's building on the free plot nearest the preview (or the map centre). */
  readonly autoPlace: (project: ToolProject) => Promise<ToolMessage>;
  /** Removes the project's building. The project itself is never touched (§22.2 #3). */
  readonly remove: (project: ToolProject) => Promise<ToolMessage>;
  /** Leaves the tool. Nothing was saved, so nothing changes. */
  readonly cancel: () => void;
  readonly dismissMessage: () => void;
}

/** The world as the tool needs it. Its size never changes. */
export interface ToolWorld {
  readonly id: string;
  readonly gridWidth: number;
  readonly gridHeight: number;
}

/**
 * What "Remove from map" does and does not do, for the confirmation (UI_SPEC §22.2 #3). Runs
 * don't exist yet (M4), so the text says they are kept without claiming anything was checked.
 */
export const REMOVE_FROM_MAP_COPY = {
  button: 'Remove from map',
  title: (name: string) => `Remove the building of “${name}” from the map?`,
  happens: [
    'Its building disappears from the world map.',
    'The project shows as “Not placed” and stays in the Projects list. You can place it again at any time.',
  ],
  doesNotHappen: [
    'The project is not deleted: its name, goal and settings are kept.',
    'No files are moved or deleted.',
    'No runs are stopped or deleted.',
  ],
  confirm: 'Remove from map',
} as const;

const IDLE: PlacementToolState = {
  mode: { kind: 'idle' },
  anchor: null,
  busy: false,
  message: null,
};

/** Why a building can't stand somewhere, as a short label for the preview. */
export function previewLabel(check: PlacementCheck): string {
  switch (check.kind) {
    case 'ok':
      return 'Fits here';
    case 'overlaps':
      return 'Blocked: another building is in the way';
    case 'out_of_bounds':
      return 'Blocked: part of it would be off the map';
    case 'reserved':
      return 'Blocked: this ground is reserved';
    case 'invalid_rotation':
      return 'Blocked: that rotation is not allowed';
  }
}

function refusalText(
  reason: PlacementRefusal['reason'] | PlacementCheck['kind'] | 'unknown',
): string {
  switch (reason) {
    case 'overlaps':
      return 'another building is in the way';
    case 'out_of_bounds':
      return 'the whole building must fit inside the world';
    case 'reserved':
      return 'that ground is reserved';
    default:
      return 'it cannot stand there';
  }
}

const tileText = (tile: Tile): string => `tile ${String(tile.tileX)}, ${String(tile.tileY)}`;

/** The pointer sits on the footprint's middle tile (the north one for an even side). */
export function anchorForPointer(
  tile: { readonly gx: number; readonly gy: number },
  footprint: Footprint,
): Tile {
  return {
    tileX: tile.gx - Math.floor((footprint.columns - 1) / 2),
    tileY: tile.gy - Math.floor((footprint.rows - 1) / 2),
  };
}

function occupiedOf(placements: readonly PlacementSummary[]): OccupiedPlacement[] {
  return placements.map((p) => ({
    id: p.id,
    tileX: p.tileX,
    tileY: p.tileY,
    rotation: p.rotation,
    footprint: p.footprint,
  }));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * The preview for the tool's current state, or null when it is idle. Recomputed from the latest
 * buildings, so a building that appears while the tool is open turns the preview red at once.
 */
export function previewOf(
  tool: PlacementToolState,
  world: ToolWorld,
  placements: readonly PlacementSummary[],
): PlacementPreview | null {
  const { mode, anchor } = tool;
  if (mode.kind === 'idle' || anchor === null) return null;
  const movingPlacementId = mode.kind === 'moving' ? mode.placementId : null;
  const check = checkPlacement(rulesWorld(world), occupiedOf(placements), {
    ...anchor,
    rotation: mode.rotation,
    footprint: mode.footprint,
    ...(movingPlacementId === null ? {} : { placementId: movingPlacementId }),
  });
  return {
    anchor,
    footprint: mode.footprint,
    rotation: mode.rotation,
    check,
    label: previewLabel(check),
    movingPlacementId,
  };
}

function rulesWorld(world: ToolWorld): PlacementWorld {
  // Nothing defines reserved areas yet (placement-rules.ts); the command passes [] too.
  return { gridWidth: world.gridWidth, gridHeight: world.gridHeight, reserved: [] };
}

/**
 * When a command gave no answer at all (the call itself failed), the change may or may not have
 * been saved. Say so, reload the map, and never send it again on our own (PRODUCT_RULES §3.1).
 */
export const UNKNOWN_OUTCOME =
  'Not sure the change was saved: the app got no answer. The map was reloaded; check it before trying again.';

/** The message for a refused or failed placement command. */
export function placementProblem(error: IpcError): string {
  switch (error.code) {
    case 'placement_blocked':
      return `It can't stand there: ${refusalText(error.placement?.reason ?? 'unknown')}. Nothing was changed.`;
    case 'revision_conflict':
      return 'This building changed somewhere else. The map was reloaded; check it and try again.';
    case 'not_found':
      return 'This project or building is no longer here. The map was reloaded.';
    case 'already_exists':
      return 'This project already has a building. The map was reloaded; move that building instead.';
    case 'invalid_transition':
      return `${error.message} Nothing was changed.`;
    default:
      return `Nothing was changed: ${error.message} (${error.code})`;
  }
}

export function createPlacementTool(
  api: PlacementToolApi,
  world: ToolWorld,
  placements: WorldPlacements,
  defaultFootprint: Footprint,
): PlacementTool {
  const store = createStore<PlacementToolState>(IDLE);
  const centre: Tile = {
    tileX: Math.floor(world.gridWidth / 2),
    tileY: Math.floor(world.gridHeight / 2),
  };

  function buildings(): readonly PlacementSummary[] {
    return placements.store.get().placements;
  }

  /** Ends the tool (if it was open) and reports what happened. */
  function finish(message: ToolMessage): ToolMessage {
    store.set({ ...IDLE, message });
    return message;
  }

  function say(message: ToolMessage): ToolMessage {
    store.set({ ...store.get(), busy: false, message });
    return message;
  }

  /** Reloads the buildings. A failed read shows its own error next to the map. */
  async function reload(): Promise<void> {
    try {
      await placements.refresh();
    } catch (error) {
      console.error('[placement] could not reload the buildings', error);
    }
  }

  /**
   * Sends one command, then reloads the buildings either way. Returns null when the call itself
   * failed (no answer), so the caller reports an unknown outcome instead of staying busy.
   */
  async function send<T>(call: () => Promise<IpcResult<T>>): Promise<IpcResult<T> | null> {
    let result: IpcResult<T> | null = null;
    try {
      result = await call();
    } catch (error) {
      console.error('[placement] command got no answer', error);
    }
    await reload();
    return result;
  }

  /** The nearest free plot for this footprint, from a start tile. */
  function freePlot(start: Tile, footprint: Footprint, placementId?: string): Tile | null {
    return findNearbyPlot(rulesWorld(world), occupiedOf(buildings()), {
      start,
      footprint,
      rotation: 0,
      ...(placementId === undefined ? {} : { placementId }),
    });
  }

  async function create(project: ToolProject, spot: Tile, how: string): Promise<ToolMessage> {
    store.set({ ...store.get(), busy: true, message: null });
    const result = await send(() =>
      api.placement.create({
        worldId: world.id,
        projectId: project.id,
        tileX: spot.tileX,
        tileY: spot.tileY,
        rotation: 0,
      }),
    );
    if (result === null) return finish({ ok: false, text: UNKNOWN_OUTCOME });
    if (result.ok) {
      return finish({
        ok: true,
        text: `Placed “${project.name}” at ${tileText(result.data.placement)}${how}.`,
      });
    }
    // Blocked: stay in the tool (if open) so the user can pick another spot.
    if (result.error.code === 'placement_blocked') {
      return say({ ok: false, text: placementProblem(result.error) });
    }
    return finish({ ok: false, text: placementProblem(result.error) });
  }

  const tool: PlacementTool = {
    store,
    startPlacing(project) {
      const existing = placementOf(placements.store.get(), project.id);
      if (existing !== undefined) {
        finish({
          ok: false,
          text: `“${project.name}” already has a building. Use Move building instead.`,
        });
        return;
      }
      const start = freePlot(centre, defaultFootprint) ?? centre;
      store.set({
        mode: { kind: 'placing', project, footprint: defaultFootprint, rotation: 0 },
        anchor: start,
        busy: false,
        message: null,
      });
    },
    startMoving(project) {
      const placement = placementOf(placements.store.get(), project.id);
      if (placement === undefined) {
        finish({ ok: false, text: `“${project.name}” has no building to move.` });
        return;
      }
      const origin = { tileX: placement.tileX, tileY: placement.tileY };
      store.set({
        mode: {
          kind: 'moving',
          project,
          placementId: placement.id,
          footprint: placement.footprint,
          rotation: placement.rotation,
          origin,
        },
        anchor: origin,
        busy: false,
        message: null,
      });
    },
    pointAt(tile) {
      const current = store.get();
      if (current.mode.kind === 'idle') return;
      const anchor = anchorForPointer(
        tile,
        rotatedFootprint(current.mode.footprint, current.mode.rotation),
      );
      if (current.anchor?.tileX === anchor.tileX && current.anchor.tileY === anchor.tileY) return;
      store.set({ ...current, anchor });
    },
    nudge(dx, dy) {
      const current = store.get();
      if (current.mode.kind === 'idle' || current.anchor === null) return;
      const size = rotatedFootprint(current.mode.footprint, current.mode.rotation);
      store.set({
        ...current,
        anchor: {
          tileX: clamp(current.anchor.tileX + dx, 0, world.gridWidth - size.columns),
          tileY: clamp(current.anchor.tileY + dy, 0, world.gridHeight - size.rows),
        },
      });
    },
    async commit() {
      const current = store.get();
      const { mode } = current;
      if (mode.kind === 'idle' || current.busy) return null;
      const preview = previewOf(current, world, buildings());
      if (preview === null) return null;

      if (mode.kind === 'placing') {
        // The preview is only a hint, but there is no point sending a spot it already refused.
        if (preview.check.kind !== 'ok') {
          return say({
            ok: false,
            text: `It can't stand there: ${refusalText(preview.check.kind)}. Pick another spot.`,
          });
        }
        return create(mode.project, preview.anchor, '');
      }

      // Moving. Dropping it where it already is changes nothing.
      if (
        preview.anchor.tileX === mode.origin.tileX &&
        preview.anchor.tileY === mode.origin.tileY
      ) {
        return finish({
          ok: true,
          text: `“${mode.project.name}” stays at ${tileText(mode.origin)}.`,
        });
      }
      // An invalid drop leaves the building where it is saved (user decision 2026-11-22).
      if (preview.check.kind !== 'ok') {
        return say({
          ok: false,
          text: `Not moved: ${refusalText(preview.check.kind)}. It stays at ${tileText(mode.origin)}.`,
        });
      }
      const placement = buildings().find((p) => p.id === mode.placementId);
      if (placement === undefined) {
        await reload();
        return finish({ ok: false, text: placementProblem({ code: 'not_found', message: '' }) });
      }
      store.set({ ...current, busy: true, message: null });
      const result = await send(() =>
        api.placement.move({
          worldId: world.id,
          placementId: placement.id,
          expectedRevision: placement.revision,
          tileX: preview.anchor.tileX,
          tileY: preview.anchor.tileY,
          rotation: mode.rotation,
        }),
      );
      if (result === null) return finish({ ok: false, text: UNKNOWN_OUTCOME });
      if (result.ok) {
        return finish({
          ok: true,
          text: `Moved “${mode.project.name}” to ${tileText(result.data.placement)}.`,
        });
      }
      if (result.error.code === 'placement_blocked') {
        return say({
          ok: false,
          text: `Not moved: ${refusalText(result.error.placement?.reason ?? 'unknown')}. It stays at ${tileText(mode.origin)}.`,
        });
      }
      return finish({ ok: false, text: placementProblem(result.error) });
    },
    async autoPlace(project) {
      const current = store.get();
      if (current.busy) return { ok: false, text: 'Another placement is still being saved.' };
      if (placementOf(placements.store.get(), project.id) !== undefined) {
        return finish({ ok: false, text: `“${project.name}” already has a building.` });
      }
      const start =
        current.mode.kind === 'placing' && current.anchor !== null ? current.anchor : centre;
      const spot = freePlot(start, defaultFootprint);
      if (spot === null) {
        return say({
          ok: false,
          text: `No free spot is big enough for a building in this world. Move or remove a building first. “${project.name}” is unchanged and still in the Projects list.`,
        });
      }
      return create(project, spot, ', the nearest free spot');
    },
    async remove(project) {
      if (store.get().busy) return { ok: false, text: 'Another placement is still being saved.' };
      const placement = placementOf(placements.store.get(), project.id);
      if (placement === undefined) {
        return finish({ ok: false, text: `“${project.name}” has no building on the map.` });
      }
      store.set({ ...store.get(), busy: true, message: null });
      const result = await send(() =>
        api.placement.remove({
          worldId: world.id,
          placementId: placement.id,
          expectedRevision: placement.revision,
        }),
      );
      if (result === null) return finish({ ok: false, text: UNKNOWN_OUTCOME });
      if (result.ok) {
        return finish({
          ok: true,
          text: `Removed the building of “${project.name}” from the map. The project, its files and its runs are kept; it shows as Not placed.`,
        });
      }
      return finish({ ok: false, text: placementProblem(result.error) });
    },
    cancel() {
      if (store.get().mode.kind === 'idle') return;
      finish({ ok: true, text: 'Placement cancelled. Nothing was changed.' });
    },
    dismissMessage() {
      const current = store.get();
      if (current.message !== null) store.set({ ...current, message: null });
    },
  };
  return tool;
}

/**
 * What the project list and the inspector may ask of the placement tool. The main screen
 * implements it: starting the tool also closes the panel that covers the map.
 */
export interface PlacementActions {
  /** Opens the tool to place the project's building. */
  readonly place: (project: ToolProject) => void;
  /** Opens the tool to move the project's building. */
  readonly move: (project: ToolProject) => void;
  readonly autoPlace: (project: ToolProject) => Promise<ToolMessage>;
  readonly remove: (project: ToolProject) => Promise<ToolMessage>;
}
