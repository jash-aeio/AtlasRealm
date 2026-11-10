// The Pixi side of the world view: builds and draws the placeholder grid.
//
// This module knows nothing about React or project data (ADR-0002: Pixi is a pure view).
// WorldCanvas owns its lifecycle and feeds it camera and hover changes.

// Must load before any renderer is created. Pixi normally generates shader/uniform code with
// `new Function()`, which our CSP forbids. Despite its name, this module swaps in prebuilt
// code so `unsafe-eval` is NOT needed.
import 'pixi.js/unsafe-eval';

import { Application, Container, Graphics, ImageSource, Sprite, Texture } from 'pixi.js';

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
import { WORLD_COLOURS, WORLD_SPRITES, worldSprite, type WorldSprite } from './world-assets';

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
  // Back to front: ground, selection, markers, hover outline.
  world.addChild(drawGround(map, tile), selected, markers, hover);
  app.stage.addChild(world);

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
    setCamera(camera) {
      world.position.set(camera.panX, camera.panY);
      world.scale.set(camera.zoom);
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
    resize(newWidth, newHeight) {
      app.renderer.resize(Math.max(1, newWidth), Math.max(1, newHeight));
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
