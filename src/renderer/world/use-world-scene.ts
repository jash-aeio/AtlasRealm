// The React side of a Pixi world (M0-4, shared by the product world since M2-6 #71): creates the
// scene once per mount, and owns the camera, hover, wheel zoom and middle-drag pan.
//
// Both WorldView (saved buildings) and the M0 spike WorldCanvas (mock markers) use it, so the
// camera behaves the same everywhere and the E2E tests cover one implementation.
import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';

import { createWorldScene, type WorldScene } from './grid-scene';
import {
  centeredCamera,
  pickTile,
  screenToWorld,
  zoomAt,
  type Camera,
  type GridPoint,
  type MapSize,
  type Point,
} from './projection';

export type WorldStatus =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly renderer: string }
  | { readonly state: 'lost'; readonly renderer: string }
  | { readonly state: 'failed' };

const RENDERER_LABELS: Record<string, string> = { webgl: 'WebGL', canvas: 'Canvas2D' };
export const INITIAL_ZOOM = 0.5;
const ZOOM_STEP = 1.25;
/** PointerEvent.buttons bit for the middle button. */
const MIDDLE_BUTTON = 4;

export function localPoint(event: { clientX: number; clientY: number }, element: Element): Point {
  const rect = element.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function sameTile(a: GridPoint | null, b: GridPoint | null): boolean {
  return a === b || (a !== null && b !== null && a.gx === b.gx && a.gy === b.gy);
}

interface WorldSceneOptions {
  readonly map: MapSize;
  /** Called once the scene exists, to give it what it should draw. */
  readonly onReady: (scene: WorldScene) => void;
  /** Called after every camera change (pan, zoom, reset). */
  readonly onCamera?: (scene: WorldScene) => void;
}

export function useWorldScene({ map, onReady, onCamera }: WorldSceneOptions) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Pixi's canvas goes in its own element that React never renders children into.
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<WorldScene | null>(null);
  const cameraRef = useRef<Camera>({ panX: 0, panY: 0, zoom: INITIAL_ZOOM });
  const hoverRef = useRef<GridPoint | null>(null);
  const panFromRef = useRef<Point | null>(null);
  const [status, setStatus] = useState<WorldStatus>({ state: 'loading' });
  const [hover, setHover] = useState<GridPoint | null>(null);
  const [zoom, setZoom] = useState(INITIAL_ZOOM);
  // The scene is created asynchronously, so keep the latest callbacks and map where it can read them.
  const latest = useRef({ map, onReady, onCamera });
  latest.current = { map, onReady, onCamera };

  const applyCamera = useCallback((camera: Camera) => {
    cameraRef.current = camera;
    const scene = sceneRef.current;
    scene?.setCamera(camera);
    // Written straight to the DOM (no React render per pointer move): the E2E tests read the
    // real camera from here instead of assuming where the map is.
    if (hostRef.current !== null) {
      hostRef.current.dataset['camera'] =
        `${String(camera.panX)},${String(camera.panY)},${String(camera.zoom)}`;
    }
    setZoom(camera.zoom);
    if (scene !== null) latest.current.onCamera?.(scene);
  }, []);

  const applyHover = useCallback((tile: GridPoint | null) => {
    if (sameTile(hoverRef.current, tile)) return;
    hoverRef.current = tile;
    sceneRef.current?.setHover(tile);
    setHover(tile);
  }, []);

  // Create Pixi once per mount. In development React StrictMode mounts, unmounts and mounts
  // again, and app.init() is async, so the cleanup can run before init finishes. The
  // `disposed` flag makes a late-finishing init destroy its own app instead of leaking it.
  useEffect(() => {
    const host = hostRef.current;
    const mount = mountRef.current;
    if (host === null || mount === null) return;
    let disposed = false;
    let scene: WorldScene | null = null;
    let observer: ResizeObserver | null = null;
    const onContextLost = (event: Event) => {
      // preventDefault tells the browser we want the context back when the GPU recovers.
      event.preventDefault();
      setStatus((current) =>
        current.state === 'ready' ? { state: 'lost', renderer: current.renderer } : current,
      );
    };
    const onContextRestored = () => {
      setStatus((current) =>
        current.state === 'lost' ? { state: 'ready', renderer: current.renderer } : current,
      );
      if (scene !== null) scene.setCamera(cameraRef.current);
    };

    const { map: startMap } = latest.current;
    createWorldScene(host.clientWidth, host.clientHeight, startMap).then(
      (created) => {
        if (disposed) {
          created.destroy();
          return;
        }
        scene = created;
        sceneRef.current = created;
        created.canvas.setAttribute('aria-hidden', 'true');
        created.canvas.addEventListener('webglcontextlost', onContextLost);
        created.canvas.addEventListener('webglcontextrestored', onContextRestored);
        mount.appendChild(created.canvas);
        latest.current.onReady(created);
        applyCamera(centeredCamera(host.clientWidth, host.clientHeight, INITIAL_ZOOM, startMap));
        // The container can change size without a window resize (panels, layout), so watch
        // the element itself rather than relying on window 'resize' events.
        observer = new ResizeObserver(() => {
          created.resize(host.clientWidth, host.clientHeight);
          latest.current.onCamera?.(created);
        });
        observer.observe(host);
        setStatus({ state: 'ready', renderer: created.rendererName });
      },
      (error: unknown) => {
        // Logged for developers; the UI shows a fixed, plain message.
        console.error('[world] renderer failed to start', error);
        if (!disposed) setStatus({ state: 'failed' });
      },
    );

    return () => {
      disposed = true;
      observer?.disconnect();
      if (scene !== null) {
        scene.canvas.removeEventListener('webglcontextlost', onContextLost);
        scene.canvas.removeEventListener('webglcontextrestored', onContextRestored);
        scene.destroy();
      }
      sceneRef.current = null;
    };
  }, [applyCamera]);

  // React's onWheel listener is passive, so it can't stop the page scrolling; add our own.
  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const onWheel = (event: WheelEvent) => {
      if (sceneRef.current === null) return;
      event.preventDefault();
      const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      applyCamera(zoomAt(cameraRef.current, localPoint(event, host), factor));
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      host.removeEventListener('wheel', onWheel);
    };
  }, [applyCamera]);

  function zoomAroundCentre(factor: number) {
    const host = hostRef.current;
    if (host === null) return;
    applyCamera(
      zoomAt(cameraRef.current, { x: host.clientWidth / 2, y: host.clientHeight / 2 }, factor),
    );
  }

  /** Back to the starting view. Only ever on request: selecting never moves the camera. */
  function resetView() {
    const host = hostRef.current;
    if (host === null) return;
    applyCamera(centeredCamera(host.clientWidth, host.clientHeight, INITIAL_ZOOM, map));
  }

  /** The world point under a pointer event, or null before the scene exists. */
  function worldPointOf(event: { clientX: number; clientY: number }): Point | null {
    const host = hostRef.current;
    if (host === null || sceneRef.current === null) return null;
    return screenToWorld(localPoint(event, host), cameraRef.current);
  }

  /** The map tile under a pointer event, or null (off the map, or before the scene exists). */
  function tileOf(event: { clientX: number; clientY: number }): GridPoint | null {
    const host = hostRef.current;
    if (host === null || sceneRef.current === null) return null;
    return pickTile(localPoint(event, host), cameraRef.current, map);
  }

  function stopPan() {
    panFromRef.current = null;
  }

  const hostHandlers = {
    onPointerMove(event: PointerEvent<HTMLDivElement>) {
      const host = hostRef.current;
      if (host === null || sceneRef.current === null) return;
      const point = localPoint(event, host);
      const from = panFromRef.current;
      // A pan whose button-up we never saw (released outside the window, capture lost) ends
      // here instead of dragging the map on the next plain move.
      if (from !== null && (event.buttons & MIDDLE_BUTTON) === 0) stopPan();
      else if (from !== null) {
        const camera = cameraRef.current;
        applyCamera({
          ...camera,
          panX: camera.panX + point.x - from.x,
          panY: camera.panY + point.y - from.y,
        });
        panFromRef.current = point;
      }
      applyHover(pickTile(point, cameraRef.current, map));
    },
    onPointerLeave() {
      applyHover(null);
    },
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      // Middle button pans (UI_SPEC §6.2).
      if (event.button !== 1 || hostRef.current === null) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      panFromRef.current = localPoint(event, hostRef.current);
    },
    onPointerUp(event: PointerEvent<HTMLDivElement>) {
      if (event.button !== 1) return;
      stopPan();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    onLostPointerCapture: stopPan,
  };

  const renderer = status.state === 'ready' || status.state === 'lost' ? status.renderer : null;
  return {
    hostRef,
    mountRef,
    sceneRef,
    status,
    ready: status.state === 'ready',
    renderer,
    rendererLabel: renderer === null ? null : (RENDERER_LABELS[renderer] ?? renderer),
    hover,
    zoom,
    zoomIn: () => {
      zoomAroundCentre(ZOOM_STEP);
    },
    zoomOut: () => {
      zoomAroundCentre(1 / ZOOM_STEP);
    },
    resetView,
    worldPointOf,
    tileOf,
    hostHandlers,
  };
}
