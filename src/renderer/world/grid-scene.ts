// The Pixi side of the world view: builds and draws the placeholder grid.
//
// This module knows nothing about React or project data (ADR-0002: Pixi is a pure view).
// WorldCanvas owns its lifecycle and feeds it camera and hover changes.

// Must load before any renderer is created. Pixi normally generates shader/uniform code with
// `new Function()`, which our CSP forbids. Despite its name, this module swaps in prebuilt
// code so `unsafe-eval` is NOT needed.
import 'pixi.js/unsafe-eval';

import { Application, Container, Graphics } from 'pixi.js';

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

/** ADR-0011: WebGL first, then Canvas2D. WebGPU is excluded until tested on real machines. */
export const RENDERER_PREFERENCE = ['webgl', 'canvas'] as const;

// Placeholder colours (ART_BIBLE values come with M0-8 art placeholders).
const GROUND_FILL = 0x34503a;
const GRID_LINE = 0x22382a;
const HOVER_FILL = 0xf2d16b;
const HOVER_LINE = 0xf2d16b;
const BACKGROUND = 0x14161c;

export interface WorldScene {
  /** The renderer Pixi actually picked ('webgl' or 'canvas'). */
  readonly rendererName: string;
  readonly canvas: HTMLCanvasElement;
  setCamera(camera: Camera): void;
  setHover(tile: GridPoint | null): void;
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
  world.addChild(drawGround(map, tile), hover);
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
