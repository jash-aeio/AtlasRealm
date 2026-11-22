import { useEffect, useMemo, useRef } from 'react';

import { spikeSelection, type SelectionState } from '../state/selection';
import { useStore } from '../state/use-store';
import { DEFAULT_MAP, type GridPoint } from './projection';
import { useWorldScene } from './use-world-scene';
import { WorldToolbar, WorldUnavailableNotices } from './WorldChrome';

function tileKey(tile: GridPoint): string {
  return `${String(tile.gx)},${String(tile.gy)}`;
}

/**
 * The M0 spike world, kept under Developer spikes: a 64 × 64 grid that draws the shared mock
 * entities and selection (M0-5) as markers. Mock data only; the product world is WorldView.
 * Left-clicking a marker selects that entity in the shared spike store.
 */
export function WorldCanvas({ state = spikeSelection }: { state?: SelectionState }) {
  const graph = useStore(state.graph);
  const selection = useStore(state.selection);
  const entitiesByTile = useMemo(
    () => new Map(graph.entities.map((entity) => [tileKey(entity.tile), entity])),
    [graph],
  );
  const selectedEntity =
    selection.entityId === null
      ? null
      : (graph.entities.find((entity) => entity.id === selection.entityId) ?? null);
  const selectedTile = selectedEntity?.tile ?? null;
  // The scene is created asynchronously, so keep the latest values where its init can read them.
  const markersRef = useRef(graph.entities.map((entity) => entity.tile));
  const selectedTileRef = useRef<GridPoint | null>(selectedTile);

  const world = useWorldScene({
    map: DEFAULT_MAP,
    onReady(scene) {
      scene.setMarkers(markersRef.current);
      scene.setSelected(selectedTileRef.current);
    },
  });
  const { sceneRef, hostRef } = world;

  // Shared store → Pixi. The scene never reads the store itself; it's only told what to draw.
  useEffect(() => {
    markersRef.current = graph.entities.map((entity) => entity.tile);
    sceneRef.current?.setMarkers(markersRef.current);
  }, [graph, sceneRef]);

  useEffect(() => {
    selectedTileRef.current = selectedTile;
    sceneRef.current?.setSelected(selectedTile);
  }, [selectedTile, sceneRef]);

  const { status, hover } = world;
  return (
    <section
      className="world"
      aria-labelledby="world-heading"
      data-testid="world"
      data-state={status.state}
      data-renderer={world.renderer ?? undefined}
      data-selected-entity={selectedEntity?.id}
      data-selected-tile={selectedTile === null ? undefined : tileKey(selectedTile)}
    >
      <WorldToolbar heading="World (M0 placeholder grid)" headingId="world-heading" world={world} />

      <div
        ref={hostRef}
        className="world-canvas"
        data-testid="world-canvas-host"
        {...world.hostHandlers}
        onClick={(event) => {
          // Left click (UI_SPEC §6.2 "click building"): select the entity on that tile, or
          // clear the selection when clicking empty ground.
          if (world.worldPointOf(event) === null) return;
          const tile = world.tileOf(event);
          const entity = tile === null ? undefined : entitiesByTile.get(tileKey(tile));
          if (entity === undefined) state.clear();
          else state.select(entity.id, 'world');
        }}
      >
        <div ref={world.mountRef} className="world-mount" />
        <WorldUnavailableNotices status={status} />
      </div>

      <p className="muted" data-testid="world-status">
        {status.state === 'loading' && 'Starting renderer…'}
        {status.state === 'failed' && 'Renderer: none'}
        {world.rendererLabel !== null &&
          `${String(DEFAULT_MAP.columns)} × ${String(DEFAULT_MAP.rows)} tiles · Renderer: ${world.rendererLabel} · Zoom ${String(Math.round(world.zoom * 100))}%`}
      </p>
      <p className="muted" data-testid="world-hover">
        {hover === null
          ? 'Hover a tile to see its grid position.'
          : `Tile ${String(hover.gx)}, ${String(hover.gy)}`}
      </p>
      <p className="muted" data-testid="world-selection">
        {selectedEntity === null
          ? 'No entity selected in the world.'
          : `Highlighted in world: ${selectedEntity.label} (${selectedEntity.id}) on tile ${tileKey(selectedEntity.tile)}`}
      </p>
    </section>
  );
}
