// The screen after onboarding, laid out per UI_SPEC §6.1 (M2-5 #70): a top bar, the sidebar
// entrances, the world area (panels open over it), the Realm Atlas + inspector column (a drawer
// in narrow windows) and the bottom bar with the Library button and the hotbar.
//
// Keys go through the one shortcut layer (shortcuts.ts): `E` toggles the library and Escape
// closes the drawer, then the open panel. Closing a panel only hides it; focus goes back to
// whatever opened it (UI_SPEC §6.6). Starting the placement tool (M2-7) closes the panel so the
// map is visible; the tool then holds focus until it closes.
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { PlaceholderAvatar } from '../onboarding/PlaceholderAvatar';
import { ProjectDetails } from '../projects/ProjectDetails';
import { ProjectsPanel } from '../projects/ProjectsPanel';
import { createProjectSelection } from '../state/selection';
import { DEFAULT_BUILDING_APPEARANCE } from '../../common/world/building-appearance';
import { createStore } from '../state/store';
import type { Session, SessionData } from '../state/session';
import { useStore } from '../state/use-store';
import { createPlacementHistory } from '../world/placement-history';
import { createPlacementTool, type PlacementActions } from '../world/placement-tool';
import { ProjectInspector } from '../world/ProjectInspector';
import { worldSprite } from '../world/world-assets';
import {
  createWorldPlacements,
  placedProjectIds,
  type WorldPlacementsState,
} from '../world/world-placements';
import { WorldErrorBoundary } from '../world/WorldErrorBoundary';
import { WorldView } from '../world/WorldView';
import { DeveloperSpikes } from './DeveloperSpikes';
import { EntrancePanel, NotBuilt } from './EntrancePanel';
import { NOT_BUILT, panelTitle, type PanelId } from './entrances';
import { SettingsView } from './SettingsView';
import { ShortcutProvider, useShortcut } from './ShortcutLayer';
import { Sidebar } from './Sidebar';
import { useMediaQuery } from './use-media-query';

interface MainScreenProps {
  readonly session: Session;
  readonly data: SessionData;
  readonly notice: string | null;
}

/** Below this width the Atlas + inspector column becomes a drawer (matches app.css). */
const NARROW = '(max-width: 60rem)';
/** Read before the screen has a world (never shown: the screen renders nothing then). */
const EMPTY_PLACEMENTS = createStore<WorldPlacementsState>({
  status: 'loading',
  placements: [],
  error: null,
});
const HOTBAR_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'] as const;

export function MainScreen(props: MainScreenProps) {
  return (
    <ShortcutProvider>
      <MainLayout {...props} />
    </ShortcutProvider>
  );
}

interface OpenPanel {
  readonly id: PanelId;
  /** False for the panel shown at startup, so loading the screen doesn't move focus. */
  readonly focus: boolean;
  /** Only for the 'project' details panel: which project of which world it shows. */
  readonly project?: { readonly worldId: string; readonly projectId: string };
}

function MainLayout({ session, data, notice }: MainScreenProps) {
  const worldSelectId = useId();
  const sideColumnId = useId();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The project list stays one glance away: it is open when the screen loads.
  const [panel, setPanel] = useState<OpenPanel | null>({ id: 'projects', focus: false });
  const opener = useRef<HTMLElement | null>(null);
  const restoreFocusTo = useRef<HTMLElement | null>(null);

  const narrow = useMediaQuery(NARROW);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerVisible = narrow && drawerOpen;
  const drawerToggle = useRef<HTMLButtonElement>(null);
  const drawerClose = useRef<HTMLButtonElement>(null);

  function openPanel(id: PanelId, project?: OpenPanel['project']) {
    const active = document.activeElement;
    opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
    setPanel({ id, focus: true, project });
  }

  /** Hides the open panel. `restoreFocus: false` when something else takes focus next. */
  function closePanel({ restoreFocus = true } = {}) {
    if (panel === null) return;
    // The opener may be gone (it lived in a panel that was replaced); then use the entrance.
    restoreFocusTo.current = !restoreFocus
      ? null
      : opener.current?.isConnected === true
        ? opener.current
        : document.querySelector<HTMLElement>(`[data-entrance="${panel.id}"]`);
    opener.current = null;
    setPanel(null);
  }

  function toggleLibrary() {
    if (panel?.id === 'library') closePanel();
    else openPanel('library');
  }

  function closeDrawer() {
    setDrawerOpen(false);
    drawerToggle.current?.focus();
  }

  // After a panel closes and React has removed it, put focus back.
  useEffect(() => {
    restoreFocusTo.current?.focus();
    restoreFocusTo.current = null;
  }, [panel]);

  useEffect(() => {
    if (drawerVisible) drawerClose.current?.focus();
  }, [drawerVisible]);

  useShortcut('e', toggleLibrary);
  useShortcut(
    'Escape',
    () => {
      if (drawerVisible) closeDrawer();
      else closePanel();
    },
    { enabled: drawerVisible || panel !== null },
  );

  // The screen is only shown with at least one world; fall back to the first if the chosen
  // one is gone (for example archived elsewhere).
  const world = data.worlds.find((w) => w.id === selectedId) ?? data.worlds[0];
  const worldId = world?.id;
  const gridWidth = world?.gridWidth ?? 0;
  const gridHeight = world?.gridHeight ?? 0;
  const profileId = data.profiles.activeProfileId;
  // Per world: its buildings, the selected project, the placement tool and its undo history.
  // Another world (or profile) starts fresh, so a project of the old world can never stay
  // selected or half-placed, and undo never reaches a change made in another world (M2-8).
  // A profile switch also reloads the window (ADR-0014); keying on it doesn't rely on that.
  const scope = useMemo(() => {
    if (worldId === undefined) return null;
    const toolWorld = { id: worldId, gridWidth, gridHeight };
    const placements = createWorldPlacements(window.atlas, worldId);
    const history = createPlacementHistory(window.atlas, toolWorld, placements);
    return {
      placements,
      selection: createProjectSelection(),
      history,
      tool: createPlacementTool(
        window.atlas,
        toolWorld,
        placements,
        worldSprite(DEFAULT_BUILDING_APPEARANCE).footprint,
        history,
      ),
    };
  }, [profileId, worldId, gridWidth, gridHeight]);
  useEffect(() => {
    void scope?.placements.refresh();
  }, [scope]);
  /** Bumped after any project change, so the inspector and details read it again. */
  const [projectChanges, setProjectChanges] = useState(0);
  /** Bumped after the inspector changed a project, so the Projects list reloads. */
  const [inspectorChanges, setInspectorChanges] = useState(0);
  const placementState = useStore(scope?.placements.store ?? EMPTY_PLACEMENTS);
  const placedIds = useMemo(
    () => (placementState.status === 'loading' ? null : placedProjectIds(placementState)),
    [placementState],
  );

  if (world === undefined || scope === null) return null;
  const { placements, selection, tool, history } = scope;

  /** The map actions the Projects list and the inspector offer (M2-7). */
  const placementActions: PlacementActions = {
    place(project) {
      closePanel({ restoreFocus: false });
      tool.startPlacing(project);
    },
    move(project) {
      closePanel({ restoreFocus: false });
      tool.startMoving(project);
    },
    autoPlace: (project) => tool.autoPlace(project),
    remove: (project) => tool.remove(project),
  };

  /** "Open" or double-click: select the project and show its details (UI_SPEC §6.2). */
  function openProject(projectId: string) {
    if (world === undefined) return;
    selection.select(projectId);
    openPanel('project', { worldId: world.id, projectId });
  }

  /** After a change in the Projects list: archive and trash remove buildings (ADR-0025). */
  function projectsChanged() {
    void placements.refresh();
    setProjectChanges((n) => n + 1);
  }

  // A details panel left open for a project of another world is not shown.
  const shownPanel = panel?.id === 'project' && panel.project?.worldId !== world.id ? null : panel;

  function panelContent(id: PanelId) {
    if (world === undefined) return null;
    if (id === 'projects') {
      return (
        <>
          <ProjectsPanel
            key={world.id}
            world={world}
            placedIds={placedIds}
            onProjectsChanged={projectsChanged}
            changeToken={inspectorChanges}
            placementActions={placementActions}
          />
          <p className="muted">
            Everything here works offline. AI work will need a model connection later; nothing asks
            for one yet.
          </p>
        </>
      );
    }
    if (id === 'settings') return <SettingsView session={session} data={data} world={world} />;
    if (id === 'project') {
      return shownPanel?.project === undefined ? null : (
        <ProjectDetails
          world={world}
          projectId={shownPanel.project.projectId}
          placements={placements}
          version={projectChanges}
        />
      );
    }
    const notBuilt = NOT_BUILT[id];
    return notBuilt === undefined ? null : <NotBuilt {...notBuilt} />;
  }

  return (
    <>
      <div className="shell">
        <div className="shell-top">
          <header className="top-bar">
            <h1 className="brand">Atlas Realm</h1>
            <div className="world-picker">
              {data.worlds.length > 1 ? (
                <>
                  <label htmlFor={worldSelectId}>World</label>
                  <select
                    id={worldSelectId}
                    value={world.id}
                    onChange={(event) => {
                      setSelectedId(event.target.value);
                    }}
                  >
                    {data.worlds.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </>
              ) : (
                <span>
                  World: <strong data-testid="world-name">{world.name}</strong>
                </span>
              )}
            </div>
            <div className="profile-chip">
              <PlaceholderAvatar colour={data.settings.avatarColour} size={28} />
              <span data-testid="profile-name">{data.settings.displayName}</span>
            </div>
            <button
              type="button"
              ref={drawerToggle}
              className="drawer-toggle"
              aria-expanded={drawerVisible}
              aria-controls={sideColumnId}
              onClick={() => {
                setDrawerOpen((open) => !open);
              }}
            >
              Atlas &amp; inspector
            </button>
          </header>
          {notice !== null && (
            <div role="status" className="notice">
              {notice}{' '}
              <button type="button" onClick={session.dismissNotice}>
                Dismiss
              </button>
            </div>
          )}
        </div>

        <Sidebar open={panel?.id ?? null} onOpen={openPanel} />

        <div className="world-area" data-testid="world-area">
          <WorldErrorBoundary>
            <WorldView
              key={world.id}
              world={world}
              placements={placements}
              selection={selection}
              tool={tool}
              history={history}
              onOpenProject={openProject}
            />
          </WorldErrorBoundary>
          {shownPanel !== null && (
            <EntrancePanel
              key={`${shownPanel.id}:${shownPanel.project?.projectId ?? ''}`}
              title={shownPanel.id === 'projects' ? world.name : panelTitle(shownPanel.id)}
              focusOnOpen={shownPanel.focus}
              onClose={closePanel}
            >
              {panelContent(shownPanel.id)}
            </EntrancePanel>
          )}
        </div>

        <aside
          id={sideColumnId}
          className="side-column"
          data-open={drawerVisible}
          aria-label="Realm Atlas and inspector"
        >
          {drawerVisible && (
            <button type="button" ref={drawerClose} onClick={closeDrawer}>
              Close Atlas &amp; inspector
            </button>
          )}
          <section className="side-card" aria-labelledby={`${sideColumnId}-atlas`}>
            <h2 id={`${sideColumnId}-atlas`}>Realm Atlas</h2>
            <p className="not-built">Not built yet (planned later in M2)</p>
            <p className="muted">
              A map of your world and the connections between projects. A mock version lives under
              Developer spikes.
            </p>
          </section>
          <section className="side-card" aria-labelledby={`${sideColumnId}-inspector`}>
            <h2 id={`${sideColumnId}-inspector`}>Inspector</h2>
            <ProjectInspector
              world={world}
              selection={selection}
              placements={placements}
              version={projectChanges}
              onOpen={openProject}
              placementActions={placementActions}
              onChanged={() => {
                projectsChanged();
                setInspectorChanges((n) => n + 1);
              }}
            />
          </section>
        </aside>

        <footer className="bottom-bar">
          <button
            type="button"
            data-entrance="library"
            aria-pressed={panel?.id === 'library'}
            aria-keyshortcuts="E"
            onClick={toggleLibrary}
          >
            Library <kbd>E</kbd>
          </button>
          <div className="hotbar" role="group" aria-label="Hotbar">
            <ol className="hotbar-slots" aria-hidden="true">
              {HOTBAR_KEYS.map((key) => (
                <li key={key} className="hotbar-slot">
                  {key}
                </li>
              ))}
            </ol>
            <span className="not-built">Hotbar: not built yet (planned later in M2)</span>
          </div>
        </footer>
      </div>

      <DeveloperSpikes />
    </>
  );
}
