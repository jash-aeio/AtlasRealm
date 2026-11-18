// A confirmation that spells out what an action does and what it does not do (PRD §5.6).
//
// Built on the native <dialog> element opened with showModal(): the browser keeps keyboard
// focus inside it, Escape closes it, and the rest of the page is inert meanwhile. When it
// closes, focus goes back to the button that opened it, or to `fallbackFocus` when that button
// is gone (for example because the project just moved to another filter) (UI_SPEC §6.6).
import { useEffect, useId, useRef } from 'react';

interface ConfirmDialogProps {
  readonly title: string;
  readonly happens: readonly string[];
  readonly doesNotHappen: readonly string[];
  readonly confirmLabel: string;
  readonly busy: boolean;
  readonly onConfirm: () => void;
  /** Called when the dialog closes for any reason (Cancel, Escape, or after confirming). */
  readonly onClose: () => void;
  readonly fallbackFocus: () => void;
}

export function ConfirmDialog({
  title,
  happens,
  doesNotHappen,
  confirmLabel,
  busy,
  onConfirm,
  onClose,
  fallbackFocus,
}: ConfirmDialogProps) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  // Read through refs in the cleanup, so it uses the latest callbacks without re-running.
  const fallback = useRef(fallbackFocus);
  fallback.current = fallbackFocus;

  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
    return () => {
      if (element.open) element.close();
      if (opener?.isConnected === true) opener.focus();
      else fallback.current();
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className="confirm-dialog"
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(event) => {
        // Escape while saving would hide a result the user is waiting for.
        if (busy) event.preventDefault();
      }}
    >
      <h2 id={titleId}>{title}</h2>
      <h3>What happens</h3>
      <ul>
        {happens.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <h3>What does not happen</h3>
      <ul>
        {doesNotHappen.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <div className="form-actions">
        {/* Cancel comes first and takes focus, so a stray Enter never confirms by accident. */}
        <button type="button" autoFocus disabled={busy} onClick={() => dialog.current?.close()}>
          Cancel
        </button>
        <button type="button" className="primary" disabled={busy} onClick={onConfirm}>
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
