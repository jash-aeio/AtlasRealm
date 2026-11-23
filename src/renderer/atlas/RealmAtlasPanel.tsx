// The Realm Atlas (M2-12 #77, GRAPH_MODEL §30.1, UI_SPEC §6.1 / §6.6): the upper-right panel
// with two explicit tabs, Map ("Where is this?") and Connections ("How is this related?").
//
// The panel shows and offers; it never changes a project. Its display choices (tab, collapsed,
// expanded, width, pinned project, follow-selection) are saved per world (ADR-0031) and are
// cosmetic: pinning a project only keeps the Atlas on it, it grants nothing.
//
// The Atlas context is the pinned project if there is one, else the selected project. "Go to"
// centres the camera on the context's building only when pressed. With "Follow selection" on,
// a new selection centres the camera too, but never while the placement tool is open (§30.1:
// don't force a camera jump while the user is editing) and never while pinned (the pin says
// "stay here").
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

import type { WorldSummary } from '../../common/contracts/world';
import {
  ATLAS_WIDTH_MAX,
  ATLAS_WIDTH_MIN,
  type AtlasTab,
  type AtlasViewChange,
} from '../../common/preferences/atlas-view';
import { useReducedMotion } from '../app/use-reduced-motion';
import { STATUS_LABELS } from '../projects/project-messages';
import { useProject } from '../projects/use-project';
import type { ProjectSelection } from '../state/selection';
import { useStore } from '../state/use-store';
import type { Comfort } from '../world/comfort';
import type { PlacementTool } from '../world/placement-tool';
import type { WorldCamera } from '../world/world-camera';
import { placementOf, type WorldPlacements } from '../world/world-placements';
import { viewOf, type AtlasViewPreferences } from './atlas-views';
import { ConnectionsTab } from './ConnectionsTab';
import { mapBuildings } from './map-geometry';
import { MapTab } from './MapTab';

interface RealmAtlasPanelProps {
  readonly world: WorldSummary;
  readonly placements: WorldPlacements;
  readonly selection: ProjectSelection;
  readonly camera: WorldCamera;
  readonly views: AtlasViewPreferences;
  /** The placement tool: while it is open the camera must not jump. */
  readonly tool: PlacementTool;
  /** Bumped by the parent after any project change, so the pinned project is read again. */
  readonly version: number;
  /** Comfort preferences: with reduced motion the Connections graph doesn't animate. */
  readonly comfort: Comfort;
}

const TABS: readonly { readonly id: AtlasTab; readonly label: string }[] = [
  { id: 'map', label: 'Map' },
  { id: 'connections', label: 'Connections' },
];

/** Keyboard step of the resize handle, in CSS pixels (Shift moves further). */
const RESIZE_STEP = 16;

const clampWidth = (width: number) =>
  Math.round(Math.min(ATLAS_WIDTH_MAX, Math.max(ATLAS_WIDTH_MIN, width)));

export function RealmAtlasPanel({
  world,
  placements,
  selection,
  camera,
  views,
  tool,
  version,
  comfort,
}: RealmAtlasPanelProps) {
  const reducedMotion = useReducedMotion(comfort);
  const toolActive = useStore(tool.store).mode.kind !== 'idle';
  const baseId = useId();
  const viewsState = useStore(views.store);
  const view = viewOf(viewsState, world.id);
  const selectedProjectId = useStore(selection.projectId);
  const placementState = useStore(placements.store);
  const viewport = useStore(camera.viewport);
  const [cameraMessage, setCameraMessage] = useState<string | null>(null);
  const tabRefs = useRef(new Map<AtlasTab, HTMLButtonElement>());

  const change = (patch: AtlasViewChange) => void views.change(world.id, patch);
  const pinned = view.pinnedProjectId;
  const contextId = pinned ?? selectedProjectId;

  /** Where a project's building is on the Map, by the saved placements. */
  function buildingOf(projectId: string) {
    const placement = placementOf(placementState, projectId);
    return placement === undefined ? undefined : mapBuildings([placement])[0];
  }
  const contextBuilding = contextId === null ? undefined : buildingOf(contextId);

  const goToBlocked =
    contextId === null
      ? 'Select a project, or pin one, to go to its building.'
      : contextBuilding === undefined
        ? 'That project has no building on the map.'
        : toolActive
          ? 'Finish or cancel the placement first.'
          : viewport === null
            ? 'The world view is not showing.'
            : null;

  function goTo() {
    if (contextBuilding === undefined) return;
    const name = contextBuilding.name ?? 'the building';
    setCameraMessage(
      camera.centerOn(contextBuilding.centre)
        ? `Camera moved to ${name}.`
        : 'The world view is not showing, so the camera did not move.',
    );
  }

  // Follow selection: only when the selection itself changes, not when buildings move or the
  // toggle is switched on, so the camera never moves unasked.
  const lastSelected = useRef(selectedProjectId);
  useEffect(() => {
    if (lastSelected.current === selectedProjectId) return;
    lastSelected.current = selectedProjectId;
    if (!view.followSelection || pinned !== null || toolActive || selectedProjectId === null) {
      return;
    }
    const placement = placementOf(placementState, selectedProjectId);
    const building = placement === undefined ? undefined : mapBuildings([placement])[0];
    if (building === undefined) {
      setCameraMessage('The selected project has no building, so the camera stayed put.');
    } else if (camera.centerOn(building.centre)) {
      setCameraMessage(`Following the selection: ${building.name ?? 'building'}.`);
    }
  }, [selectedProjectId, view.followSelection, pinned, toolActive, placementState, camera]);

  function onTabKey(event: KeyboardEvent<HTMLDivElement>) {
    const index = TABS.findIndex((t) => t.id === view.tab);
    let next: AtlasTab | undefined;
    if (event.key === 'ArrowRight') next = TABS[(index + 1) % TABS.length]?.id;
    else if (event.key === 'ArrowLeft') next = TABS[(index - 1 + TABS.length) % TABS.length]?.id;
    else if (event.key === 'Home') next = TABS[0]?.id;
    else if (event.key === 'End') next = TABS[TABS.length - 1]?.id;
    if (next === undefined) return;
    // Handled here, so the shortcut layer and the page leave the key alone.
    event.preventDefault();
    change({ tab: next });
    tabRefs.current.get(next)?.focus();
  }

  const headingId = `${baseId}-heading`;
  const bodyId = `${baseId}-body`;
  const canPin = selectedProjectId !== null && selectedProjectId !== pinned;

  return (
    <section
      className="side-card atlas-panel"
      aria-labelledby={headingId}
      data-testid="realm-atlas"
      data-collapsed={view.collapsed ? 'true' : 'false'}
      data-expanded={view.expanded ? 'true' : 'false'}
    >
      <div className="atlas-panel-header">
        <h2 id={headingId}>Realm Atlas</h2>
        <button
          type="button"
          aria-expanded={!view.collapsed}
          aria-controls={bodyId}
          data-testid="atlas-collapse"
          onClick={() => {
            change({ collapsed: !view.collapsed });
          }}
        >
          {view.collapsed ? 'Show' : 'Collapse'}
        </button>
        <button
          type="button"
          aria-pressed={view.expanded}
          data-testid="atlas-expand"
          onClick={() => {
            change({ expanded: !view.expanded });
          }}
        >
          Expand
        </button>
      </div>

      {pinned !== null && (
        <PinnedIndicator
          worldId={world.id}
          projectId={pinned}
          version={version}
          onUnpin={() => {
            change({ pinnedProjectId: null });
          }}
        />
      )}
      {viewsState.error !== null && (
        <p role="alert" className="error">
          Could not save the Atlas layout: {viewsState.error.message} ({viewsState.error.code}). The
          saved layout is shown.
        </p>
      )}

      <div id={bodyId} hidden={view.collapsed}>
        {!view.collapsed && (
          <>
            <div
              role="tablist"
              aria-label="Realm Atlas views"
              className="atlas-tabs"
              onKeyDown={onTabKey}
            >
              {TABS.map((t) => (
                <button
                  key={t.id}
                  ref={(element) => {
                    if (element === null) tabRefs.current.delete(t.id);
                    else tabRefs.current.set(t.id, element);
                  }}
                  type="button"
                  role="tab"
                  id={`${baseId}-tab-${t.id}`}
                  aria-selected={t.id === view.tab}
                  aria-controls={`${baseId}-panel`}
                  tabIndex={t.id === view.tab ? 0 : -1}
                  onClick={() => {
                    change({ tab: t.id });
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div
              role="tabpanel"
              id={`${baseId}-panel`}
              aria-labelledby={`${baseId}-tab-${view.tab}`}
              className="atlas-tabpanel"
            >
              {view.tab === 'map' ? (
                <MapTab
                  world={world}
                  placements={placements}
                  camera={camera}
                  selectedProjectId={selectedProjectId}
                  pinnedProjectId={pinned}
                  onSelect={selection.select}
                  onGoTo={goTo}
                  goToBlocked={goToBlocked}
                  followSelection={view.followSelection}
                  onFollowChange={(follow) => {
                    change({ followSelection: follow });
                  }}
                  cameraMessage={cameraMessage}
                />
              ) : (
                <ConnectionsTab
                  world={world}
                  selectedProjectId={selectedProjectId}
                  onSelect={selection.select}
                  version={version}
                  reducedMotion={reducedMotion}
                />
              )}
            </div>
            <div className="atlas-pin-actions">
              <button
                type="button"
                data-testid="atlas-pin-button"
                disabled={!canPin}
                title={
                  selectedProjectId === null
                    ? 'Select a project first'
                    : canPin
                      ? undefined
                      : 'Already pinned'
                }
                onClick={() => {
                  if (selectedProjectId !== null) change({ pinnedProjectId: selectedProjectId });
                }}
              >
                Pin to selected project
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/** "Pinned to: Name · Unpin", visible even while the panel is collapsed (§30.1). */
function PinnedIndicator({
  worldId,
  projectId,
  version,
  onUnpin,
}: {
  readonly worldId: string;
  readonly projectId: string;
  readonly version: number;
  readonly onUnpin: () => void;
}) {
  const load = useProject(worldId, projectId, version);
  const text =
    load.status === 'loading'
      ? 'Pinned to a project…'
      : load.status === 'error'
        ? load.error.code === 'not_found'
          ? 'Pinned to a project that is no longer here.'
          : `Pinned to a project that could not be read (${load.error.code}).`
        : `Pinned to: ${load.project.name}${load.project.status === 'active' ? '' : ` (${STATUS_LABELS[load.project.status]})`}`;
  return (
    <p className="atlas-pin" data-testid="atlas-pin">
      <span className="atlas-pin-mark" aria-hidden="true">
        ◆
      </span>{' '}
      {text}{' '}
      <button type="button" onClick={onUnpin}>
        Unpin
      </button>
    </p>
  );
}

/**
 * The handle on the side column's left edge that resizes it (WAI-ARIA window splitter): drag
 * it, or focus it and use the arrow keys (left widens, right narrows; Shift moves further),
 * Home and End.
 */
export function AtlasResizeHandle({
  width,
  onWidth,
}: {
  readonly width: number;
  readonly onWidth: (width: number) => void;
}) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? RESIZE_STEP * 4 : RESIZE_STEP;
    let next: number | null = null;
    if (event.key === 'ArrowLeft') next = width + step;
    else if (event.key === 'ArrowRight') next = width - step;
    else if (event.key === 'Home') next = ATLAS_WIDTH_MIN;
    else if (event.key === 'End') next = ATLAS_WIDTH_MAX;
    if (next === null) return;
    event.preventDefault();
    onWidth(clampWidth(next));
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the Realm Atlas and inspector"
      aria-valuemin={ATLAS_WIDTH_MIN}
      aria-valuemax={ATLAS_WIDTH_MAX}
      aria-valuenow={width}
      tabIndex={0}
      className="atlas-resize"
      data-testid="atlas-resize"
      onKeyDown={onKeyDown}
      onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { startX: event.clientX, startWidth: width };
      }}
      onPointerMove={(event: PointerEvent<HTMLDivElement>) => {
        const from = drag.current;
        if (from === null) return;
        // The handle is on the left edge, so moving left makes the column wider.
        onWidth(clampWidth(from.startWidth + from.startX - event.clientX));
      }}
      onPointerUp={(event: PointerEvent<HTMLDivElement>) => {
        drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
    />
  );
}
