// The placement tool's HTML controls (M2-7 #72): what is being placed or moved, the preview's
// tile and whether it fits (as text, never colour alone, UI_SPEC §6.5), and the buttons that
// make the tool usable without a pointer (UI_SPEC §6.6): Place/Move here, Auto-place, Cancel.
//
// Also shows the result of the last placement action. That line stays after the tool closes,
// and takes focus when the button that started the tool is gone, so a keyboard or screen-reader
// user hears what happened.
import { useEffect, useRef } from 'react';

import type { PlacementPreview, PlacementTool, PlacementToolState } from './placement-tool';

interface PlacementToolBarProps {
  readonly tool: PlacementTool;
  readonly state: PlacementToolState;
  readonly preview: PlacementPreview | null;
}

export function PlacementToolBar({ tool, state, preview }: PlacementToolBarProps) {
  const { mode, busy, message } = state;
  const commitButton = useRef<HTMLButtonElement>(null);
  const messageLine = useRef<HTMLParagraphElement>(null);
  /** Whatever had focus when the tool opened, to give focus back when it closes. */
  const opener = useRef<HTMLElement | null>(null);
  const active = mode.kind !== 'idle';

  // Opening the tool moves focus to its main button; closing it gives focus back.
  useEffect(() => {
    if (active) {
      const focused = document.activeElement;
      opener.current = focused instanceof HTMLElement && focused !== document.body ? focused : null;
      commitButton.current?.focus();
      return;
    }
    const back = opener.current;
    opener.current = null;
    if (back?.isConnected === true) back.focus();
    else if (back !== null || document.activeElement === document.body)
      messageLine.current?.focus();
  }, [active]);

  return (
    <>
      {mode.kind !== 'idle' && preview !== null && (
        <div
          className="placement-tool"
          role="group"
          aria-label="Placement tool"
          data-testid="placement-tool"
          data-mode={mode.kind}
          data-fits={String(preview.check.kind === 'ok')}
          data-anchor={`${String(preview.anchor.tileX)},${String(preview.anchor.tileY)}`}
        >
          <p>
            <strong>
              {mode.kind === 'placing'
                ? `Placing “${mode.project.name}”`
                : `Moving “${mode.project.name}”`}
            </strong>{' '}
            · Tile {preview.anchor.tileX}, {preview.anchor.tileY} ·{' '}
            <span
              data-testid="placement-preview"
              className={preview.check.kind === 'ok' ? 'ok' : 'error'}
            >
              {preview.check.kind === 'ok' ? '✓ ' : '✕ '}
              {preview.label}
            </span>
          </p>
          <p className="muted">
            {mode.kind === 'placing'
              ? 'Click a tile to place the building'
              : 'Drag the building to a free spot and let go, or click a tile'}
            , or move the preview with the arrow keys and press{' '}
            {mode.kind === 'placing' ? 'Place here' : 'Move here'}. Escape cancels.
          </p>
          <div className="placement-tool-actions">
            <button
              ref={commitButton}
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void tool.commit()}
            >
              {busy ? 'Saving…' : mode.kind === 'placing' ? 'Place here' : 'Move here'}
            </button>
            {mode.kind === 'placing' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void tool.autoPlace(mode.project)}
              >
                Auto-place
              </button>
            )}
            <button type="button" disabled={busy} onClick={tool.cancel}>
              Cancel <kbd>Esc</kbd>
            </button>
          </div>
        </div>
      )}
      {message !== null && (
        <p
          ref={messageLine}
          tabIndex={-1}
          role={message.ok ? 'status' : 'alert'}
          className={`placement-message ${message.ok ? 'ok' : 'error'}`}
          data-testid="placement-message"
        >
          {message.text}{' '}
          <button type="button" onClick={tool.dismissMessage}>
            Dismiss
          </button>
        </p>
      )}
    </>
  );
}
