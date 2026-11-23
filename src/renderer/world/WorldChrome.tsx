// The HTML around a world canvas, shared by WorldView and the spike WorldCanvas: the heading
// with zoom controls (the non-wheel way to zoom, UI_SPEC §6.6) and the "unavailable" messages.
import type { ReactNode } from 'react';

import type { WorldStatus } from './use-world-scene';

/** The world message shown instead of the canvas. Also used by WorldErrorBoundary. */
export function WorldUnavailable({ reason }: { reason: string }) {
  return (
    <div role="alert" className="world-message" data-testid="world-unavailable">
      <strong>World view unavailable.</strong> {reason} Everything else in the app still works.
    </div>
  );
}

export function WorldUnavailableNotices({ status }: { status: WorldStatus }) {
  if (status.state === 'failed') {
    return <WorldUnavailable reason="This computer couldn't start WebGL or Canvas2D graphics." />;
  }
  if (status.state === 'lost') {
    return (
      <WorldUnavailable reason="The graphics context was lost; it comes back when the GPU recovers." />
    );
  }
  return null;
}

interface WorldToolbarProps {
  readonly heading: string;
  readonly headingId: string;
  readonly world: {
    readonly ready: boolean;
    readonly zoomIn: () => void;
    readonly zoomOut: () => void;
    readonly resetView: () => void;
  };
  /** Extra view controls after the zoom buttons, such as the labels toggle (M2-14). */
  readonly children?: ReactNode;
}

export function WorldToolbar({ heading, headingId, world, children }: WorldToolbarProps) {
  return (
    <div className="world-toolbar">
      <h2 id={headingId}>{heading}</h2>
      <div className="world-view-controls">
        <div role="group" aria-label="Zoom">
          <button type="button" disabled={!world.ready} onClick={world.zoomOut}>
            Zoom out
          </button>{' '}
          <button type="button" disabled={!world.ready} onClick={world.zoomIn}>
            Zoom in
          </button>{' '}
          <button type="button" disabled={!world.ready} onClick={world.resetView}>
            Reset view
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
