// Undo and Redo for placement changes (M2-8 #73): two buttons above the map, Ctrl+Z / Ctrl+Y /
// Ctrl+Shift+Z through the shortcut layer (which leaves text fields and dialogs alone), and the
// result of the last undo or redo.
//
// Both wait while the placement tool is open or saving: undoing under an unsaved preview would
// change the map it is pointing at. Escape closes the tool first.
import type { PlacementHistory, PlacementHistoryState } from './placement-history';
import type { PlacementTool, PlacementToolState } from './placement-tool';
import { useShortcut } from '../app/ShortcutLayer';

interface PlacementHistoryControlsProps {
  readonly history: PlacementHistory;
  readonly state: PlacementHistoryState;
  readonly tool: PlacementTool;
  readonly toolState: PlacementToolState;
}

export function PlacementHistoryControls({
  history,
  state,
  tool,
  toolState,
}: PlacementHistoryControlsProps) {
  const { undoLabel, redoLabel, busy, message } = state;
  const toolOpen = toolState.mode.kind !== 'idle' || toolState.busy;
  const canUndo = undoLabel !== null && !busy && !toolOpen;
  const canRedo = redoLabel !== null && !busy && !toolOpen;
  const waitNote = toolOpen ? ' (finish or cancel the placement first)' : '';

  function run(action: 'undo' | 'redo') {
    if (action === 'undo' ? !canUndo : !canRedo) return;
    // The tool's last message is about an older change; the new result replaces it.
    tool.dismissMessage();
    void history[action]();
  }

  useShortcut(
    'z',
    () => {
      run('undo');
    },
    { ctrl: true },
  );
  useShortcut(
    'y',
    () => {
      run('redo');
    },
    { ctrl: true },
  );
  useShortcut(
    'z',
    () => {
      run('redo');
    },
    { ctrl: true, shift: true },
  );

  return (
    <>
      <div
        className="placement-history"
        role="group"
        aria-label="Undo placement changes"
        data-testid="placement-history"
      >
        <button
          type="button"
          disabled={!canUndo}
          aria-keyshortcuts="Control+Z"
          aria-label={
            undoLabel === null ? 'Undo (nothing to undo)' : `Undo: ${undoLabel}${waitNote}`
          }
          title={undoLabel === null ? 'Nothing to undo' : `Undo: ${undoLabel} (Ctrl+Z)`}
          onClick={() => {
            run('undo');
          }}
        >
          ↶ Undo
        </button>
        <button
          type="button"
          disabled={!canRedo}
          aria-keyshortcuts="Control+Y Control+Shift+Z"
          aria-label={
            redoLabel === null ? 'Redo (nothing to redo)' : `Redo: ${redoLabel}${waitNote}`
          }
          title={redoLabel === null ? 'Nothing to redo' : `Redo: ${redoLabel} (Ctrl+Y)`}
          onClick={() => {
            run('redo');
          }}
        >
          ↷ Redo
        </button>
        {busy && <span role="status">Saving…</span>}
      </div>
      {message !== null && (
        <p
          role={message.ok ? 'status' : 'alert'}
          className={`placement-message ${message.ok ? 'ok' : 'error'}`}
          data-testid="placement-history-message"
        >
          {message.text}{' '}
          <button type="button" onClick={history.dismissMessage}>
            Dismiss
          </button>
        </p>
      )}
    </>
  );
}
