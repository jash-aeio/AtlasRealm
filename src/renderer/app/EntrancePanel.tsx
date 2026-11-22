// The panel an entrance opens over the world area. It has a heading and one way out ("Back to
// world", or Escape through the shortcut layer). Closing only unmounts the view: nothing saved
// is changed by it.
import { useEffect, useId, useRef, type ReactNode } from 'react';

interface EntrancePanelProps {
  readonly title: string;
  /** Move focus to the heading when the panel opens (not for the panel shown at startup). */
  readonly focusOnOpen: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

export function EntrancePanel({ title, focusOnOpen, onClose, children }: EntrancePanelProps) {
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (focusOnOpen) heading.current?.focus();
    // Only on open: a later prop change must not pull focus back to the heading.
  }, []);

  return (
    <section className="entrance-panel" aria-labelledby={headingId} data-testid="entrance-panel">
      <div className="entrance-panel-header">
        <h2 id={headingId} ref={heading} tabIndex={-1}>
          {title}
        </h2>
        <button type="button" onClick={onClose} aria-keyshortcuts="Escape">
          Back to world
        </button>
      </div>
      {children}
    </section>
  );
}

/** The whole content of a panel whose feature is not built yet. */
export function NotBuilt({
  planned,
  purpose,
}: {
  readonly planned: string;
  readonly purpose: string;
}) {
  return (
    <>
      <p className="not-built" data-testid="not-built">
        {planned}
      </p>
      <p className="muted">{purpose}</p>
    </>
  );
}
