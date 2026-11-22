// The Pixi side of the world view: draws the ground grid, the saved buildings (M2-6) and the M0
// spike markers.
//
// This module knows nothing about React, IPC or project data (ADR-0002: Pixi is a pure view).
// useWorldScene owns its lifecycle and feeds it camera, hover and the buildings to draw, already
// laid out and depth-sorted by buildings.ts.

// Must load before any renderer is created. Pixi normally generates shader/uniform code with
// `new Function()`, which our CSP forbids. Despite its name, this module swaps in prebuilt
// code so `unsafe-eval` is NOT needed.
import 'pixi.js/unsafe-eval';

import { Application, Container, Graphics, ImageSource, Sprite, Text, Texture } from 'pixi.js';

import type { TileRect } from '../../common/world/placement-rules';
import {
  buildingLabel,
  footprintCorners,
  isOnScreen,
  MISSING_ART_HEIGHT,
  type Box,
  type WorldBuilding,
} from './buildings';

import {
  DEFAULT_MAP,
  DEFAULT_TILE,
  gridToWorld,
  type Camera,
  type GridPoint,
  type MapSize,
  type Point,
  type TileSize,
} from './projection';
import {
  buildingSprites,
  WORLD_COLOURS,
  WORLD_SPRITES,
  worldSprite,
  type WorldSprite,
} from './world-assets';

/** ADR-0011: WebGL first, then Canvas2D. WebGPU is excluded until tested on real machines. */
export const RENDERER_PREFERENCE = ['webgl', 'canvas'] as const;

// Colours from the ART_BIBLE palette (M0-8). The selection highlight is a placeholder sprite.
const GROUND_FILL = WORLD_COLOURS.ground;
const GRID_LINE = WORLD_COLOURS.gridLine;
const HOVER_FILL = WORLD_COLOURS.hover;
const HOVER_LINE = WORLD_COLOURS.hover;
const BACKGROUND = WORLD_COLOURS.background;
const MARKER_FILL = WORLD_COLOURS.marker;
const MARKER_LINE = WORLD_COLOURS.markerLine;
/** Markers are half-size diamonds centred in their tile, so the selection shows around them. */
const MARKER_SCALE = 0.5;

/**
 * Name labels stay this size on screen at every zoom (user decision 2026-11-23, ADR-0028) and
 * are hidden below LABEL_MIN_ZOOM, where the map is an overview and labels would pile up.
 */
export const LABEL_MIN_ZOOM = 0.35;
/** World pixels a status sign ("Archived", "Missing art") takes, so a name label sits above it. */
const STATUS_SIGN_HEIGHT = 22;

/** The placement tool's preview (M2-7): which tiles, whether it fits, and its text label. */
export interface ScenePlacementPreview {
  readonly rect: TileRect;
  readonly fits: boolean;
  /** Shown on a sign above the preview, so the colour never stands alone (UI_SPEC §6.5). */
  readonly label: string;
  /** The building art to show faded on the spot, or null for tiles only. */
  readonly appearanceId: string | null;
  /** A building being moved: drawn faded at its saved spot meanwhile. */
  readonly fadedPlacementId: string | null;
}

export interface WorldScene {
  /** The renderer Pixi actually picked ('webgl' or 'canvas'). */
  readonly rendererName: string;
  readonly canvas: HTMLCanvasElement;
  setCamera(camera: Camera): void;
  setHover(tile: GridPoint | null): void;
  /** Placeholder markers for entities (M0-5 mock data). Replaces any previous markers. */
  setMarkers(tiles: readonly GridPoint[]): void;
  /** Highlights the selected entity's tile, or nothing. */
  setSelected(tile: GridPoint | null): void;
  /** The saved buildings, back to front (buildings.ts). Replaces any previous buildings. */
  setBuildings(buildings: readonly WorldBuilding[]): void;
  /** Outlines the footprint of the building with this placement ID, or nothing. */
  setSelectedBuilding(placementId: string | null): void;
  /** Shows the placement tool's preview, or nothing. */
  setPlacementPreview(preview: ScenePlacementPreview | null): void;
  /** Shows or hides the buildings' name labels (M2-14, UI_SPEC §6.6). On by default. */
  setLabels(show: boolean): void;
  /** How many name labels are drawn right now (shown to tests). */
  readonly drawnLabelCount: () => number;
  /** How many buildings are drawn after culling (shown to tests and the dev measurement). */
  readonly drawnBuildingCount: () => number;
  resize(width: number, height: number): void;
  destroy(): void;
}

function diamond(origin: GridPoint, map: MapSize, tile: TileSize): Point[] {
  return [
    gridToWorld(origin, tile),
    gridToWorld({ gx: origin.gx + map.columns, gy: origin.gy }, tile),
    gridToWorld({ gx: origin.gx + map.columns, gy: origin.gy + map.rows }, tile),
    gridToWorld({ gx: origin.gx, gy: origin.gy + map.rows }, tile),
  ];
}

function drawGround(map: MapSize, tile: TileSize): Graphics {
  const ground = new Graphics();
  ground.poly(diamond({ gx: 0, gy: 0 }, map, tile)).fill({ color: GROUND_FILL });
  // Grid lines instead of 4096 separate diamonds: 130 segments in one Graphics.
  for (let gx = 0; gx <= map.columns; gx++) {
    const from = gridToWorld({ gx, gy: 0 }, tile);
    const to = gridToWorld({ gx, gy: map.rows }, tile);
    ground.moveTo(from.x, from.y).lineTo(to.x, to.y);
  }
  for (let gy = 0; gy <= map.rows; gy++) {
    const from = gridToWorld({ gx: 0, gy }, tile);
    const to = gridToWorld({ gx: map.columns, gy }, tile);
    ground.moveTo(from.x, from.y).lineTo(to.x, to.y);
  }
  // pixelLine keeps lines 1 device pixel wide at every zoom level.
  ground.stroke({ width: 1, color: GRID_LINE, pixelLine: true });
  return ground;
}

function drawHover(tile: TileSize): Graphics {
  const hover = new Graphics();
  hover
    .poly(diamond({ gx: 0, gy: 0 }, { columns: 1, rows: 1 }, tile))
    .fill({ color: HOVER_FILL, alpha: 0.25 })
    .stroke({ width: 1, color: HOVER_LINE, pixelLine: true });
  hover.visible = false;
  return hover;
}

/**
 * Loads a bundled image with a plain <img> element. We don't use Pixi's Assets loader: by
 * default it decodes in blob: workers (our CSP blocks them, and its support check can hang
 * without an error) and fetches with CORS, and the renderer can't fetch() app:// URLs at all.
 * An <img> load is an ordinary same-origin image request that CSP img-src 'self' allows.
 */
async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = url;
  // decode() rejects if the file is missing or not an image, so failures surface here.
  await image.decode();
  return image;
}

/**
 * A sprite placed by its manifest pivot: its anchor is the pivot, and it sits on the south
 * corner of its footprint. Nearest-neighbour sampling keeps pixel art crisp (ART_BIBLE).
 */
function createPivotSprite(art: WorldSprite, image: HTMLImageElement): Sprite {
  const source = new ImageSource({ resource: image, scaleMode: 'nearest' });
  const sprite = new Sprite(new Texture({ source }));
  sprite.anchor.set(art.pivot.x / art.width, art.pivot.y / art.height);
  sprite.label = art.id;
  return sprite;
}

/** World position of a sprite's pivot when its footprint's north tile is `tile`. */
function pivotPosition(art: WorldSprite, at: GridPoint, tile: TileSize): Point {
  return gridToWorld({ gx: at.gx + art.footprint.columns, gy: at.gy + art.footprint.rows }, tile);
}

/** Redraws all markers into one Graphics: one draw call however many entities there are. */
function drawMarkers(markers: Graphics, tiles: readonly GridPoint[], tile: TileSize): void {
  markers.clear();
  const inset = (1 - MARKER_SCALE) / 2;
  for (const at of tiles) {
    const origin = { gx: at.gx + inset, gy: at.gy + inset };
    markers.poly(diamond(origin, { columns: MARKER_SCALE, rows: MARKER_SCALE }, tile));
  }
  markers.fill({ color: MARKER_FILL }).stroke({ width: 1, color: MARKER_LINE, pixelLine: true });
}

/** Screen pixels around the view where buildings stay drawn, so panning never shows a gap. */
const CULL_MARGIN = 64;
/** Room above a building for its sign, in world pixels (part of the culling box). */
const SIGN_ROOM = 28;
/** An archived project's building is faded and greyed, and also carries an "Archived" sign. */
const ARCHIVED_TINT = WORLD_COLOURS.stoneLight;
const ARCHIVED_ALPHA = 0.6;
/** A building being moved stays visible at its saved spot, faded, until the move is saved. */
const MOVING_ALPHA = 0.35;
/** The building art drawn on the preview spot. A blocked spot is also tinted red. */
const GHOST_ALPHA = 0.6;
const GHOST_BLOCKED_TINT = 0xff8a80;

/**
 * A small text sign above a building. Text is always paired with any colour change (UI_SPEC
 * §6.5), so an archived or broken building never relies on colour alone.
 */
function drawSign(text: string, x: number, bottom: number): Container {
  const sign = new Container();
  const label = new Text({
    text,
    style: { fontFamily: 'system-ui, sans-serif', fontSize: 13, fill: WORLD_COLOURS.parchment },
    anchor: { x: 0.5, y: 1 },
  });
  const padX = 5;
  const padY = 2;
  const background = new Graphics()
    .roundRect(
      -label.width / 2 - padX,
      -label.height - padY * 2,
      label.width + padX * 2,
      label.height + padY * 2,
      3,
    )
    .fill({ color: WORLD_COLOURS.ink, alpha: 0.85 });
  label.position.set(0, -padY);
  sign.addChild(background, label);
  sign.position.set(x, bottom);
  return sign;
}

/**
 * Lost art (ADR-0025): a plain stone block on the stored footprint, so the building still shows
 * where it stands and stays selectable.
 */
function drawMissingArt(building: WorldBuilding, tile: TileSize): Graphics {
  const { north, east, south, west } = footprintCorners(building.rect, tile);
  const up = (point: Point): Point => ({ x: point.x, y: point.y - MISSING_ART_HEIGHT });
  const block = new Graphics();
  block.poly([west, south, up(south), up(west)]).fill({ color: WORLD_COLOURS.stone });
  block.poly([south, east, up(east), up(south)]).fill({ color: WORLD_COLOURS.stoneDark });
  block.poly([up(north), up(east), up(south), up(west)]).fill({ color: WORLD_COLOURS.stoneLight });
  block
    .poly([west, south, east, up(east), up(north), up(west)])
    .stroke({ width: 1, color: WORLD_COLOURS.ink, pixelLine: true });
  return block;
}

/** One building: its sprite (or the missing-art block) plus a sign when it needs one. */
function drawBuilding(
  building: WorldBuilding,
  textures: ReadonlyMap<string, { art: WorldSprite; texture: Texture }>,
  tile: TileSize,
): Container {
  const node = new Container();
  node.label = `building:${building.placementId}`;
  const loaded = building.art === null ? undefined : textures.get(building.appearanceId);
  if (loaded === undefined) {
    node.addChild(drawMissingArt(building, tile));
  } else {
    const sprite = new Sprite(loaded.texture);
    sprite.anchor.set(
      loaded.art.pivot.x / loaded.art.width,
      loaded.art.pivot.y / loaded.art.height,
    );
    sprite.position.set(building.pivot.x, building.pivot.y);
    if (building.archived) {
      sprite.tint = ARCHIVED_TINT;
      sprite.alpha = ARCHIVED_ALPHA;
    }
    node.addChild(sprite);
  }
  const sign = statusSign(building, loaded !== undefined);
  if (sign !== null) node.addChild(drawSign(sign, building.pivot.x, building.bounds.top - 2));
  return node;
}

/** The status sign a building carries, if any. Status signs are always shown. */
function statusSign(building: WorldBuilding, hasArt: boolean): string | null {
  return !hasArt ? 'Missing art' : building.archived ? 'Archived' : null;
}

/**
 * A building's name label, or null for a building without a name (a service structure). Its
 * origin is the bottom middle, so scaling it by 1 / zoom keeps it the same size on screen and
 * still standing just above the building (and above any status sign).
 */
function drawNameLabel(building: WorldBuilding, hasArt: boolean): Container | null {
  if (building.name === null) return null;
  const label = drawSign(buildingLabel(building.name), 0, 0);
  const holder = new Container();
  holder.addChild(label);
  const above = statusSign(building, hasArt) === null ? 0 : STATUS_SIGN_HEIGHT;
  holder.position.set(building.pivot.x, building.bounds.top - 2 - above);
  return holder;
}

/** The selected building's footprint outline, drawn above the buildings so it always shows. */
function drawBuildingOutline(outline: Graphics, building: WorldBuilding | null, tile: TileSize) {
  outline.clear();
  if (building === null) return;
  const { north, east, south, west } = footprintCorners(building.rect, tile);
  outline
    .poly([north, east, south, west])
    .fill({ color: WORLD_COLOURS.selection, alpha: 0.2 })
    .stroke({ width: 3, color: WORLD_COLOURS.selection })
    .poly([north, east, south, west])
    .stroke({ width: 1, color: WORLD_COLOURS.selectionEdge, pixelLine: true });
}

/**
 * Creates the Pixi application and draws the grid. Rejects if no allowed renderer works;
 * the caller shows a message instead of the canvas.
 *
 * Rendering is on demand (no 60 FPS loop): the scene is static, and UI_SPEC §17.4 says users
 * must not need a GPU-heavy scene running. Any change schedules one frame.
 */
export async function createWorldScene(
  width: number,
  height: number,
  map: MapSize = DEFAULT_MAP,
  tile: TileSize = DEFAULT_TILE,
): Promise<WorldScene> {
  // Load the art first: if a bundled file is missing there is no app to clean up yet.
  const selectionArt = worldSprite(WORLD_SPRITES.selection);
  const selectionImage = await loadImage(selectionArt.url);
  const invalidArt = worldSprite(WORLD_SPRITES.invalid);
  const invalidImage = await loadImage(invalidArt.url);
  const buildingArt = buildingSprites();
  const buildingImages = await Promise.all(buildingArt.map((art) => loadImage(art.url)));

  const app = new Application();
  try {
    await app.init({
      width: Math.max(1, width),
      height: Math.max(1, height),
      preference: [...RENDERER_PREFERENCE],
      background: BACKGROUND,
      antialias: true,
      // Sharp on high-DPI screens; the canvas stays sized in CSS pixels (our screen space).
      resolution: window.devicePixelRatio,
      autoDensity: true,
      autoStart: false,
      sharedTicker: false,
    });
  } catch (error) {
    // A half-initialised app may hold a context; release what we can and report the failure.
    try {
      app.destroy({ removeView: true }, { children: true });
    } catch {
      // Nothing more to release.
    }
    throw error;
  }

  const world = new Container();
  const hover = drawHover(tile);
  const selected = createPivotSprite(selectionArt, selectionImage);
  selected.visible = false;
  const markers = new Graphics();
  const buildingLayer = new Container();
  const buildingOutline = new Graphics();
  const labelLayer = new Container();
  const previewLayer = new Container();
  // Back to front: ground, spike selection, spike markers, buildings, building selection,
  // name labels (above every building, so one never hides behind another), placement
  // preview, hover outline.
  world.addChild(
    drawGround(map, tile),
    selected,
    markers,
    buildingLayer,
    buildingOutline,
    labelLayer,
    previewLayer,
    hover,
  );
  const imageTexture = (image: HTMLImageElement) =>
    new Texture({ source: new ImageSource({ resource: image, scaleMode: 'nearest' }) });
  const fitsTexture = imageTexture(selectionImage);
  const blockedTexture = imageTexture(invalidImage);
  app.stage.addChild(world);

  // One texture per appearance, shared by every building that uses it.
  const textures = new Map<string, { art: WorldSprite; texture: Texture }>();
  buildingArt.forEach((art, index) => {
    const image = buildingImages[index];
    if (image === undefined) return;
    const source = new ImageSource({ resource: image, scaleMode: 'nearest' });
    textures.set(art.id, { art, texture: new Texture({ source }) });
  });

  let camera: Camera = { panX: 0, panY: 0, zoom: 1 };
  let viewWidth = Math.max(1, width);
  let viewHeight = Math.max(1, height);
  let buildings: readonly WorldBuilding[] = [];
  let buildingNodes: Container[] = [];
  /** One per building, in the same order; null for a building without a name. */
  let labelNodes: (Container | null)[] = [];
  let showLabels = true;
  let drawnLabels = 0;
  let selectedPlacementId: string | null = null;
  let fadedPlacementId: string | null = null;
  let drawn = 0;

  /** The moving building is drawn faded; every other one at its normal strength. */
  const applyFade = () => {
    buildings.forEach((building, index) => {
      const node = buildingNodes[index];
      if (node !== undefined)
        node.alpha = building.placementId === fadedPlacementId ? MOVING_ALPHA : 1;
    });
  };

  /** Redraws the preview from scratch: at most 16 tile markers, a ghost and a sign. */
  const drawPreview = (preview: ScenePlacementPreview | null) => {
    for (const node of previewLayer.removeChildren())
      node.destroy({ children: true, context: true });
    if (preview === null) return;
    const { rect } = preview;
    const art = preview.fits ? selectionArt : invalidArt;
    for (let dy = 0; dy < rect.rows; dy++) {
      for (let dx = 0; dx < rect.columns; dx++) {
        const marker = new Sprite(preview.fits ? fitsTexture : blockedTexture);
        marker.anchor.set(art.pivot.x / art.width, art.pivot.y / art.height);
        const at = pivotPosition(art, { gx: rect.x + dx, gy: rect.y + dy }, tile);
        marker.position.set(at.x, at.y);
        previewLayer.addChild(marker);
      }
    }
    const corners = footprintCorners(rect, tile);
    let top = corners.north.y;
    const loaded = preview.appearanceId === null ? undefined : textures.get(preview.appearanceId);
    if (loaded !== undefined) {
      const ghost = new Sprite(loaded.texture);
      ghost.anchor.set(
        loaded.art.pivot.x / loaded.art.width,
        loaded.art.pivot.y / loaded.art.height,
      );
      ghost.position.set(corners.south.x, corners.south.y);
      ghost.alpha = GHOST_ALPHA;
      if (!preview.fits) ghost.tint = GHOST_BLOCKED_TINT;
      previewLayer.addChild(ghost);
      top = Math.min(top, corners.south.y - loaded.art.pivot.y);
    }
    previewLayer.addChild(drawSign(preview.label, corners.south.x, top - 2));
  };

  /** Hides buildings outside the view (UI_SPEC §17.4: cull offscreen sprites). */
  const cull = () => {
    drawn = 0;
    buildings.forEach((building, index) => {
      const node = buildingNodes[index];
      if (node === undefined) return;
      const box: Box = { ...building.bounds, top: building.bounds.top - SIGN_ROOM };
      node.visible = isOnScreen(box, camera, viewWidth, viewHeight, CULL_MARGIN);
      if (node.visible) drawn++;
    });
    updateLabels();
  };

  /** Labels follow their building's culling, the toggle and the zoom; sized for the screen. */
  function updateLabels() {
    drawnLabels = 0;
    const zoomedIn = camera.zoom >= LABEL_MIN_ZOOM;
    labelNodes.forEach((label, index) => {
      if (label === null) return;
      label.visible = showLabels && zoomedIn && buildingNodes[index]?.visible === true;
      label.scale.set(1 / camera.zoom);
      if (label.visible) drawnLabels++;
    });
  }

  const outlineSelected = () => {
    const building = buildings.find((b) => b.placementId === selectedPlacementId) ?? null;
    drawBuildingOutline(buildingOutline, building, tile);
  };

  let frame: number | null = null;
  let destroyed = false;
  const requestRender = () => {
    if (frame !== null || destroyed) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      if (!destroyed) app.render();
    });
  };

  return {
    rendererName: app.renderer.name,
    canvas: app.canvas,
    setCamera(next) {
      camera = next;
      world.position.set(next.panX, next.panY);
      world.scale.set(next.zoom);
      cull();
      requestRender();
    },
    setHover(target) {
      hover.visible = target !== null;
      if (target !== null) {
        const at = gridToWorld(target, tile);
        hover.position.set(at.x, at.y);
      }
      requestRender();
    },
    setMarkers(tiles) {
      drawMarkers(markers, tiles, tile);
      requestRender();
    },
    setSelected(target) {
      selected.visible = target !== null;
      if (target !== null) {
        const at = pivotPosition(selectionArt, target, tile);
        selected.position.set(at.x, at.y);
      }
      requestRender();
    },
    setBuildings(next) {
      // Rebuilt from scratch: at most a few hundred nodes, and only when the saved list changes.
      // Shared textures survive; each Graphics frees the shapes it built (context: true).
      for (const node of [...buildingLayer.removeChildren(), ...labelLayer.removeChildren()])
        node.destroy({ children: true, context: true });
      buildings = next;
      buildingNodes = next.map((building) => drawBuilding(building, textures, tile));
      if (buildingNodes.length > 0) buildingLayer.addChild(...buildingNodes);
      labelNodes = next.map((building) =>
        drawNameLabel(building, building.art !== null && textures.has(building.appearanceId)),
      );
      const labels = labelNodes.filter((label) => label !== null);
      if (labels.length > 0) labelLayer.addChild(...labels);
      applyFade();
      outlineSelected();
      cull();
      requestRender();
    },
    setSelectedBuilding(placementId) {
      selectedPlacementId = placementId;
      outlineSelected();
      requestRender();
    },
    setPlacementPreview(preview) {
      fadedPlacementId = preview?.fadedPlacementId ?? null;
      applyFade();
      drawPreview(preview);
      requestRender();
    },
    setLabels(show) {
      showLabels = show;
      updateLabels();
      requestRender();
    },
    drawnBuildingCount: () => drawn,
    drawnLabelCount: () => drawnLabels,
    resize(newWidth, newHeight) {
      viewWidth = Math.max(1, newWidth);
      viewHeight = Math.max(1, newHeight);
      app.renderer.resize(viewWidth, viewHeight);
      cull();
      requestRender();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (frame !== null) cancelAnimationFrame(frame);
      // removeView takes the canvas out of the DOM; releasing children/textures frees GPU memory.
      app.destroy({ removeView: true }, { children: true, texture: true, textureSource: true });
    },
  };
}
