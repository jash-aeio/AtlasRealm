// The product world on the main screen (M2-6 #71, UI_SPEC §6.2 / §17): the world's saved
// buildings, drawn from `placement.list` with the bundled placeholder art.
//
// A pure view. The buildings come from the placements store, the selection from the project
// selection store, and nothing here writes data: a click only selects, a double-click only asks
// the parent to open the project's details. The camera moves only when the user pans, zooms or
// resets, never because something was selected.
import { useEffect, useMemo, useRef } from 'react';

import type { PlacementSummary } from '../../common/contracts/placement';
import type { WorldSummary } from '../../common/contracts/world';
import type { ProjectSelection } from '../state/selection';
import { useStore } from '../state/use-store';
import {
  layoutBuildings,
  pickBuilding,
  type BuildingArt,
  type PlacedBuilding,
  type WorldBuilding,
} from './buildings';
import type { WorldScene } from './grid-scene';
import { DEFAULT_TILE, type MapSize } from './projection';
import { useWorldScene } from './use-world-scene';
import { buildingSprites } from './world-assets';
import type { WorldPlacements } from './world-placements';
import { WorldToolbar, WorldUnavailableNotices } from './WorldChrome';

interface WorldViewProps {
  readonly world: WorldSummary;
  readonly placements: WorldPlacements;
  readonly selection: ProjectSelection;
  /** Double-click on a project's building: show that project's details. */
  readonly onOpenProject: (projectId: string) => void;
}

/** Bundled building art by appearance ID. Read once: the manifest is part of the build. */
let artById: ReadonlyMap<string, BuildingArt> | undefined;
function artFor(appearanceId: string): BuildingArt | null {
  artById ??= new Map(buildingSprites().map((sprite) => [sprite.id, sprite]));
  return artById.get(appearanceId) ?? null;
}

function toPlaced(placement: PlacementSummary): PlacedBuilding {
  return {
    placementId: placement.id,
    projectId: placement.target.type === 'project' ? placement.target.id : null,
    archived: placement.projectStatus === 'archived',
    appearanceId: placement.appearanceId,
    tileX: placement.tileX,
    tileY: placement.tileY,
    rotation: placement.rotation,
    footprint: placement.footprint,
  };
}

/**
 * How many buildings survive culling, written straight to the DOM for tests and the
 * performance measurement (no React render per camera move).
 */
function reportDrawn(element: HTMLElement | null, scene: WorldScene): void {
  if (element !== null) element.dataset['drawnBuildings'] = String(scene.drawnBuildingCount());
}

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

export function WorldView({ world, placements, selection, onOpenProject }: WorldViewProps) {
  const map = useMemo<MapSize>(
    () => ({ columns: world.gridWidth, rows: world.gridHeight }),
    [world.gridWidth, world.gridHeight],
  );
  const state = useStore(placements.store);
  const selectedProjectId = useStore(selection.projectId);
  const buildings = useMemo(
    () => layoutBuildings(state.placements.map(toPlaced), artFor, DEFAULT_TILE),
    [state.placements],
  );
  const selectedBuilding =
    selectedProjectId === null
      ? null
      : (buildings.find((b) => b.projectId === selectedProjectId) ?? null);
  // The scene is created asynchronously, so keep the latest values where its init can read them.
  const buildingsRef = useRef<readonly WorldBuilding[]>(buildings);
  const selectedRef = useRef<string | null>(selectedBuilding?.placementId ?? null);

  const sectionRef = useRef<HTMLElement>(null);

  const view = useWorldScene({
    map,
    onReady(scene) {
      scene.setBuildings(buildingsRef.current);
      scene.setSelectedBuilding(selectedRef.current);
      reportDrawn(sectionRef.current, scene);
    },
    onCamera(scene) {
      reportDrawn(sectionRef.current, scene);
    },
  });
  const { sceneRef, hostRef, status, hover } = view;

  // Store → Pixi. The scene never reads a store itself; it's only told what to draw.
  useEffect(() => {
    buildingsRef.current = buildings;
    const scene = sceneRef.current;
    if (scene === null) return;
    scene.setBuildings(buildings);
    reportDrawn(sectionRef.current, scene);
  }, [buildings, sceneRef]);

  const selectedPlacementId = selectedBuilding?.placementId ?? null;
  useEffect(() => {
    selectedRef.current = selectedPlacementId;
    sceneRef.current?.setSelectedBuilding(selectedPlacementId);
  }, [selectedPlacementId, sceneRef]);

  /** The project building under a pointer event, or null (ground, service, no scene yet). */
  function projectAt(event: { clientX: number; clientY: number }): string | null {
    const point = view.worldPointOf(event);
    if (point === null) return null;
    return pickBuilding(buildings, point)?.projectId ?? null;
  }

  const hoveredBuilding =
    hover === null
      ? null
      : (buildings.find(
          (b) =>
            hover.gx >= b.rect.x &&
            hover.gx < b.rect.x + b.rect.columns &&
            hover.gy >= b.rect.y &&
            hover.gy < b.rect.y + b.rect.rows,
        ) ?? null);
  const archivedCount = buildings.filter((b) => b.archived).length;
  const missingArtCount = buildings.filter((b) => b.art === null).length;

  return (
    <section
      ref={sectionRef}
      className="world world-product"
      aria-labelledby="world-view-heading"
      data-testid="world-view"
      data-state={status.state}
      data-renderer={view.renderer ?? undefined}
      data-buildings={state.status === 'ready' ? String(buildings.length) : undefined}
      data-selected-placement={selectedPlacementId ?? undefined}
    >
      <WorldToolbar heading={world.name} headingId="world-view-heading" world={view} />

      <div
        ref={hostRef}
        className="world-canvas"
        data-testid="world-view-host"
        {...view.hostHandlers}
        onClick={(event) => {
          // UI_SPEC §6.2: click a building to select its project; click the ground to clear.
          if (view.worldPointOf(event) === null) return;
          const projectId = projectAt(event);
          if (projectId === null) selection.clear();
          else selection.select(projectId);
        }}
        onDoubleClick={(event) => {
          const projectId = projectAt(event);
          if (projectId !== null) onOpenProject(projectId);
        }}
      >
        <div ref={view.mountRef} className="world-mount" />
        <WorldUnavailableNotices status={status} />
      </div>

      {state.error !== null && (
        <div role="alert" className="error" data-testid="world-view-error">
          Could not read this world&apos;s buildings: {state.error.message} ({state.error.code}){' '}
          <button type="button" onClick={() => void placements.refresh()}>
            Try again
          </button>
        </div>
      )}

      <p className="muted" data-testid="world-view-status">
        {status.state === 'loading' && 'Starting renderer…'}
        {status.state === 'failed' && 'Renderer: none. Your projects are all in the Projects list.'}
        {view.rendererLabel !== null &&
          [
            `${String(map.columns)} × ${String(map.rows)} tiles`,
            state.status === 'loading'
              ? 'Reading buildings…'
              : `${plural(buildings.length, 'building', 'buildings')} (placeholder art)`,
            archivedCount > 0 ? `${String(archivedCount)} archived` : null,
            missingArtCount > 0 ? `${String(missingArtCount)} missing art` : null,
            `Renderer: ${view.rendererLabel}`,
            `Zoom ${String(Math.round(view.zoom * 100))}%`,
          ]
            .filter((part) => part !== null)
            .join(' · ')}
      </p>
      <p className="muted" data-testid="world-view-hover">
        {hover === null
          ? 'Hover the map to see a tile. Click a building to select its project.'
          : `Tile ${String(hover.gx)}, ${String(hover.gy)}${hoveredBuilding === null ? '' : ' · building'}`}
      </p>
      {state.status === 'ready' && buildings.length === 0 && (
        <p className="muted" data-testid="world-view-empty">
          No buildings in this world yet. Every project is still in the Projects list, marked “Not
          placed”.
        </p>
      )}
    </section>
  );
}
