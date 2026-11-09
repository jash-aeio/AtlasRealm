import { useCallback, useEffect, useRef, useState } from 'react';

import { createWorldScene, type WorldScene } from './grid-scene';
import {
  centeredCamera,
  DEFAULT_MAP,
  pickTile,
  zoomAt,
  type Camera,
  type GridPoint,
  type Point,
} from './projection';

type WorldStatus =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly renderer: string }
  | { readonly state: 'lost'; readonly renderer: string }
  | { readonly state: 'failed' };

const RENDERER_LABELS: Record<string, string> = { webgl: 'WebGL', canvas: 'Canvas2D' };
const INITIAL_ZOOM = 0.5;
const ZOOM_STEP = 1.25;

function localPoint(event: { clientX: number; clientY: number }, element: Element): Point {
  const rect = element.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function sameTile(a: GridPoint | null, b: GridPoint | null): boolean {
  return a === b || (a !== null && b !== null && a.gx === b.gx && a.gy === b.gy);
}

/** The world message shown instead of the canvas. Also used by WorldErrorBoundary. */
export function WorldUnavailable({ reason }: { reason: string }) {
  return (
    <div role="alert" className="world-message" data-testid="world-unavailable">
      <strong>World view unavailable.</strong> {reason} Everything else in the app still works.
    </div>
  );
}

/**
 * Placeholder isometric world (M0 spike): a 64 × 64 grid with hover, wheel zoom and
 * middle-drag pan. A pure view: it reads no project data and stores nothing.
 */
export function WorldCanvas() {
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

  const applyCamera = useCallback((camera: Camera) => {
    cameraRef.current = camera;
    sceneRef.current?.setCamera(camera);
    setZoom(camera.zoom);
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

    createWorldScene(host.clientWidth, host.clientHeight).then(
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
        applyCamera(centeredCamera(host.clientWidth, host.clientHeight, INITIAL_ZOOM));
        // The container can change size without a window resize (panels, layout), so watch
        // the element itself rather than relying on window 'resize' events.
        observer = new ResizeObserver(() => {
          created.resize(host.clientWidth, host.clientHeight);
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

  function resetView() {
    const host = hostRef.current;
    if (host === null) return;
    applyCamera(centeredCamera(host.clientWidth, host.clientHeight, INITIAL_ZOOM));
  }

  const ready = status.state === 'ready';
  const renderer = status.state === 'ready' || status.state === 'lost' ? status.renderer : null;
  const rendererLabel = renderer === null ? null : (RENDERER_LABELS[renderer] ?? renderer);

  return (
    <section
      className="world"
      aria-labelledby="world-heading"
      data-testid="world"
      data-state={status.state}
      data-renderer={renderer ?? undefined}
    >
      <div className="world-toolbar">
        <h2 id="world-heading">World (M0 placeholder grid)</h2>
        <div role="group" aria-label="Zoom">
          <button
            type="button"
            disabled={!ready}
            onClick={() => {
              zoomAroundCentre(1 / ZOOM_STEP);
            }}
          >
            Zoom out
          </button>{' '}
          <button
            type="button"
            disabled={!ready}
            onClick={() => {
              zoomAroundCentre(ZOOM_STEP);
            }}
          >
            Zoom in
          </button>{' '}
          <button type="button" disabled={!ready} onClick={resetView}>
            Reset view
          </button>
        </div>
      </div>

      <div
        ref={hostRef}
        className="world-canvas"
        data-testid="world-canvas-host"
        onPointerMove={(event) => {
          const host = hostRef.current;
          if (host === null || sceneRef.current === null) return;
          const point = localPoint(event, host);
          const from = panFromRef.current;
          if (from !== null) {
            const camera = cameraRef.current;
            applyCamera({
              ...camera,
              panX: camera.panX + point.x - from.x,
              panY: camera.panY + point.y - from.y,
            });
            panFromRef.current = point;
          }
          applyHover(pickTile(point, cameraRef.current, DEFAULT_MAP));
        }}
        onPointerLeave={() => {
          applyHover(null);
        }}
        onPointerDown={(event) => {
          // Middle button pans (UI_SPEC §6.2).
          if (event.button !== 1 || hostRef.current === null) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          panFromRef.current = localPoint(event, hostRef.current);
        }}
        onPointerUp={(event) => {
          if (event.button !== 1) return;
          panFromRef.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
      >
        <div ref={mountRef} className="world-mount" />
        {status.state === 'failed' && (
          <WorldUnavailable reason="This computer couldn't start WebGL or Canvas2D graphics." />
        )}
        {status.state === 'lost' && (
          <WorldUnavailable reason="The graphics context was lost; it comes back when the GPU recovers." />
        )}
      </div>

      <p className="muted" data-testid="world-status">
        {status.state === 'loading' && 'Starting renderer…'}
        {status.state === 'failed' && 'Renderer: none'}
        {rendererLabel !== null &&
          `${String(DEFAULT_MAP.columns)} × ${String(DEFAULT_MAP.rows)} tiles · Renderer: ${rendererLabel} · Zoom ${String(Math.round(zoom * 100))}%`}
      </p>
      <p className="muted" data-testid="world-hover">
        {hover === null
          ? 'Hover a tile to see its grid position.'
          : `Tile ${String(hover.gx)}, ${String(hover.gy)}`}
      </p>
    </section>
  );
}
