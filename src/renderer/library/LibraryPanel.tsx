// The library (UI_SPEC §6.3, M2-9 #74): the panel that `E` or the bottom bar's "Library [E]"
// opens. Its Projects tab is the full project list, so everything about a project, including
// one with no building, can be done here without the world canvas (UI_SPEC §6.6). The other
// resource tabs are labelled as planned instead of showing fake content.
//
// The tabs follow the WAI-ARIA tabs pattern (library-tabs.ts). The parent keeps the selected
// tab, so reopening the library shows the tab it was left on.
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

import { AppearancesTab } from './AppearancesTab';
import { LIBRARY_TABS, PLANNED_LABEL, tabForKey, type LibraryTabId } from './library-tabs';

interface LibraryPanelProps {
  readonly tab: LibraryTabId;
  readonly onTabChange: (tab: LibraryTabId) => void;
  /** The Projects tab's content: the project list, wired up by the main screen. */
  readonly projects: ReactNode;
}

export function LibraryPanel({ tab, onTabChange, projects }: LibraryPanelProps) {
  const baseId = useId();
  const tabRefs = useRef(new Map<LibraryTabId, HTMLButtonElement>());
  const selected = LIBRARY_TABS.find((t) => t.id === tab) ?? LIBRARY_TABS[0];
  if (selected === undefined) return null;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const next = tabForKey(tab, event.key);
    if (next === null) return;
    // Handled here, so the shortcut layer and the page leave the key alone.
    event.preventDefault();
    onTabChange(next);
    tabRefs.current.get(next)?.focus();
  }

  return (
    <div className="library">
      <div
        role="tablist"
        aria-label="Library sections"
        className="library-tabs"
        onKeyDown={onKeyDown}
      >
        {LIBRARY_TABS.map((t) => (
          <button
            key={t.id}
            ref={(element) => {
              if (element === null) tabRefs.current.delete(t.id);
              else tabRefs.current.set(t.id, element);
            }}
            type="button"
            role="tab"
            id={`${baseId}-tab-${t.id}`}
            aria-selected={t.id === tab}
            aria-controls={`${baseId}-panel`}
            tabIndex={t.id === tab ? 0 : -1}
            onClick={() => {
              onTabChange(t.id);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-panel`}
        aria-labelledby={`${baseId}-tab-${selected.id}`}
        className="library-panel"
        // The panel itself is focusable so Tab from the tab list lands inside it (APG pattern).
        tabIndex={0}
      >
        {selected.id === 'projects' ? (
          projects
        ) : selected.id === 'appearances' ? (
          <AppearancesTab />
        ) : (
          <>
            <p className="not-built" data-testid="library-planned">
              {PLANNED_LABEL}
            </p>
            <p className="muted">{selected.planned}</p>
          </>
        )}
      </div>
    </div>
  );
}
