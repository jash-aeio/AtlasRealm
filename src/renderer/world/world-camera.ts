// A small bridge between the world view and the Realm Atlas Map (M2-12 #77, GRAPH_MODEL §30.1).
//
// The world view owns the camera. It reports what it shows (the camera plus the canvas size) to
// `viewport`, so the Map can draw the viewport rectangle without reaching into Pixi. The Map asks
// for a camera move through `centerOn`, which only the world view carries out, and only when the
// user asked ("Go to", or the follow-selection toggle they switched on). Nothing here moves the
// camera by itself.
//
// Pure TypeScript with no React or DOM imports, so it's unit-tested in plain Node.
import { createStore, type Store } from '../state/store';
import { clampZoom, screenToWorld, type Camera, type Point } from './projection';

/** What the world view shows: its camera and canvas size in CSS pixels. */
export interface Viewport {
  readonly camera: Camera;
  readonly width: number;
  readonly height: number;
}

/** An axis-aligned rectangle in world pixels. */
export interface WorldRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface WorldCamera {
  /** The live viewport, or null while no world view is showing (hidden, not started). */
  readonly viewport: Store<Viewport | null>;
  /** Called by the world view after every camera or size change; null when it goes away. */
  readonly report: (viewport: Viewport | null) => void;
  /**
   * Asks the world view to put a world point in the middle of the canvas. Returns false when no
   * world view is listening, so the caller can say why nothing happened.
   */
  readonly centerOn: (point: Point) => boolean;
  /** The world view registers how to centre; the returned function unregisters it. */
  readonly attach: (centre: (point: Point) => void) => () => void;
}

function sameViewport(a: Viewport | null, b: Viewport | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.width === b.width &&
    a.height === b.height &&
    a.camera.panX === b.camera.panX &&
    a.camera.panY === b.camera.panY &&
    a.camera.zoom === b.camera.zoom
  );
}

export function createWorldCamera(): WorldCamera {
  const viewport = createStore<Viewport | null>(null, sameViewport);
  let centre: ((point: Point) => void) | null = null;
  return {
    viewport,
    report(next) {
      viewport.set(next);
    },
    centerOn(point) {
      if (centre === null) return false;
      centre(point);
      return true;
    },
    attach(handler) {
      centre = handler;
      return () => {
        if (centre === handler) centre = null;
      };
    },
  };
}

/** The part of the world a viewport shows, in world pixels. The camera only scales and pans. */
export function viewportWorldRect({ camera, width, height }: Viewport): WorldRect {
  const topLeft = screenToWorld({ x: 0, y: 0 }, camera);
  const bottomRight = screenToWorld({ x: width, y: height }, camera);
  return { left: topLeft.x, top: topLeft.y, right: bottomRight.x, bottom: bottomRight.y };
}

/** The camera that puts `point` in the middle of a `width` × `height` canvas at `zoom`. */
export function cameraCentredOn(point: Point, zoom: number, width: number, height: number): Camera {
  const z = clampZoom(zoom);
  return { zoom: z, panX: width / 2 - point.x * z, panY: height / 2 - point.y * z };
}
