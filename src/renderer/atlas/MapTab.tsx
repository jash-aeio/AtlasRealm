// The Realm Atlas Map tab (M2-12 #77, GRAPH_MODEL §30.1): "Where is this?" for the world. It
// draws the world's bounds, its saved buildings, the selected and pinned buildings, and the part
// of the world the camera shows, all derived from `placement.list` and the world's size.
//
// Clicking a building (or its row in the list below) selects its project and never moves the
// camera. "Go to" moves the camera only when pressed. The SVG is a picture for pointer users;
// the list is the keyboard and screen-reader equivalent (UI_SPEC §6.6), so the shapes
// themselves are not focusable.
import { useId, useMemo } from 'react';

import type { WorldSummary } from '../../common/contracts/world';
import { useStore } from '../state/use-store';
import type { MapSize } from '../world/projection';
import { viewportWorldRect, type WorldCamera } from '../world/world-camera';
import type { WorldPlacements } from '../world/world-placements';
import {
  clippedViewport,
  mapBuildings,
  mapCorners,
  mapViewBox,
  polygonPoints,
  type MapBuilding,
} from './map-geometry';

interface MapTabProps {
  readonly world: WorldSummary;
  readonly placements: WorldPlacements;
  readonly camera: WorldCamera;
  readonly selectedProjectId: string | null;
  readonly pinnedProjectId: string | null;
  /** Select a project (a building was clicked); the camera stays where it is. */
  readonly onSelect: (projectId: string) => void;
  /** "Go to": centre the camera on the Atlas context's building. */
  readonly onGoTo: () => void;
  /** Why "Go to" can't run right now, or null when it can. */
  readonly goToBlocked: string | null;
  readonly followSelection: boolean;
  readonly onFollowChange: (follow: boolean) => void;
  /** A one-line result of the last "Go to" or follow move, or null. */
  readonly cameraMessage: string | null;
}

function buildingTitle(building: MapBuilding): string {
  const name = building.name ?? 'Service building';
  return `${name}${building.archived ? ' (archived)' : ''} · tile ${String(building.rect.x)}, ${String(building.rect.y)}`;
}

export function MapTab({
  world,
  placements,
  camera,
  selectedProjectId,
  pinnedProjectId,
  onSelect,
  onGoTo,
  goToBlocked,
  followSelection,
  onFollowChange,
  cameraMessage,
}: MapTabProps) {
  const followId = useId();
  const map = useMemo<MapSize>(
    () => ({ columns: world.gridWidth, rows: world.gridHeight }),
    [world.gridWidth, world.gridHeight],
  );
  const state = useStore(placements.store);
  const viewport = useStore(camera.viewport);
  const buildings = useMemo(() => mapBuildings(state.placements), [state.placements]);
  const shown = viewport === null ? null : clippedViewport(viewportWorldRect(viewport), map);
  const projectBuildings = buildings.filter((b) => b.projectId !== null);

  return (
    <div className="atlas-map" data-testid="atlas-map">
      <svg
        className="atlas-map-svg"
        viewBox={mapViewBox(map)}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`Map of ${world.name}: ${String(buildings.length)} ${buildings.length === 1 ? 'building' : 'buildings'}`}
        data-buildings={state.status === 'loading' ? undefined : String(buildings.length)}
        data-viewport={
          shown === null
            ? 'none'
            : [shown.left, shown.top, shown.right, shown.bottom].map((n) => n.toFixed(1)).join(',')
        }
      >
        <polygon className="atlas-map-ground" points={polygonPoints(mapCorners(map))} />
        {buildings.map((building) => {
          const selected = building.projectId !== null && building.projectId === selectedProjectId;
          const pinned = building.projectId !== null && building.projectId === pinnedProjectId;
          return (
            <polygon
              key={building.placementId}
              className="atlas-map-building"
              points={polygonPoints(building.corners)}
              data-placement-id={building.placementId}
              data-project-id={building.projectId ?? undefined}
              data-selected={selected ? 'true' : undefined}
              data-pinned={pinned ? 'true' : undefined}
              data-archived={building.archived ? 'true' : undefined}
              onClick={() => {
                if (building.projectId !== null) onSelect(building.projectId);
              }}
            >
              <title>{buildingTitle(building)}</title>
            </polygon>
          );
        })}
        {/* The pin is a shape as well as a colour, so it reads without colour (UI_SPEC §6.5). */}
        {buildings
          .filter((b) => b.projectId !== null && b.projectId === pinnedProjectId)
          .map((b) => (
            <circle
              key={`pin-${b.placementId}`}
              className="atlas-map-pin"
              cx={b.centre.x}
              cy={b.centre.y}
              r={Math.max(24, map.columns * 1.5)}
            />
          ))}
        {shown !== null && (
          <rect
            className="atlas-map-viewport"
            data-testid="atlas-map-viewport"
            x={shown.left}
            y={shown.top}
            width={shown.right - shown.left}
            height={shown.bottom - shown.top}
          />
        )}
      </svg>

      <p className="muted atlas-map-legend">
        <span className="atlas-legend-selected">Thick outline: selected</span> ·{' '}
        <span className="atlas-legend-pinned">Ring: pinned</span> ·{' '}
        <span className="atlas-legend-viewport">Dashed box: what the world view shows</span>
      </p>

      <p className="muted" data-testid="atlas-map-status">
        {state.status === 'loading'
          ? 'Reading buildings…'
          : `${String(map.columns)} × ${String(map.rows)} tiles · ${String(buildings.length)} ${buildings.length === 1 ? 'building' : 'buildings'}`}
        {' · '}
        {viewport === null ? 'World view not showing, so no viewport' : 'Viewport shown'}
      </p>
      {state.error !== null && (
        <p role="alert" className="error">
          Could not read this world&apos;s buildings: {state.error.message} ({state.error.code})
        </p>
      )}

      <div className="atlas-map-actions">
        <button
          type="button"
          data-testid="atlas-go-to"
          disabled={goToBlocked !== null}
          title={goToBlocked ?? undefined}
          onClick={onGoTo}
        >
          Go to
        </button>
        <label htmlFor={followId}>
          <input
            id={followId}
            type="checkbox"
            data-testid="atlas-follow"
            checked={followSelection}
            onChange={(event) => {
              onFollowChange(event.target.checked);
            }}
          />{' '}
          Follow selection
        </label>
      </div>
      <p className="muted" role="status" data-testid="atlas-camera-message">
        {goToBlocked ?? cameraMessage ?? ''}
      </p>

      <details className="atlas-list" data-testid="atlas-map-list">
        <summary>Buildings list ({projectBuildings.length})</summary>
        {projectBuildings.length === 0 ? (
          <p className="muted">
            No project buildings in this world yet. Every project is still in the Projects list.
          </p>
        ) : (
          <ul>
            {projectBuildings.map((building) => (
              <li key={building.placementId}>
                <button
                  type="button"
                  aria-pressed={building.projectId === selectedProjectId}
                  onClick={() => {
                    if (building.projectId !== null) onSelect(building.projectId);
                  }}
                >
                  {buildingTitle(building)}
                  {building.projectId === pinnedProjectId ? ' · pinned' : ''}
                </button>
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}
