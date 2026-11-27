// The screen after onboarding, laid out per UI_SPEC §6.1 (M2-5 #70): a top bar, the sidebar
// entrances, the world area (panels open over it), the Realm Atlas + inspector column (a drawer
// in narrow windows) and the bottom bar with the Library button and the hotbar.
//
// Keys go through the one shortcut layer (shortcuts.ts): `E` toggles the library and Escape
// closes the drawer, then the open panel. Closing a panel only hides it; focus goes back to
// whatever opened it (UI_SPEC §6.6). Starting the placement tool (M2-7) closes the panel so the
// map is visible; the tool then holds focus until it closes.
//
// The hotbar (M2-10 #75) belongs to the world: keys 1–0 select a pinned project or open a
// pinned service's panel. "Pin to hotbar" sits in the project list, the library, the inspector
// and the service panels.
//
// "Hide world view" (M2-9 #74) unmounts the canvas for this session; nothing is saved. Every
// project action stays in the Projects panel and the library. Placing or moving by hand needs
// the map, so those show it again.
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';

import { atlasViewOf, ATLAS_WIDTH_MAX } from '../../common/preferences/atlas-view';
import { createAtlasViewPreferences } from '../atlas/atlas-views';
import { AtlasResizeHandle, RealmAtlasPanel } from '../atlas/RealmAtlasPanel';

import {
  createHotbar,
  SERVICE_ENTRANCES,
  serviceOfEntrance,
  type HotbarEntry,
} from '../hotbar/hotbar-store';
import { Hotbar } from '../hotbar/Hotbar';
import { PinServiceToHotbar } from '../hotbar/PinToHotbar';
import type { LibraryTabId } from '../library/library-tabs';
import { LibraryPanel } from '../library/LibraryPanel';
import { PlaceholderAvatar } from '../onboarding/PlaceholderAvatar';
import { ProjectDetails } from '../projects/ProjectDetails';
import { ProjectsPanel } from '../projects/ProjectsPanel';
import { createProjectSelection } from '../state/selection';
import { DEFAULT_BUILDING_APPEARANCE } from '../../common/world/building-appearance';
import { createStore } from '../state/store';
import { omittedNotice } from '../state/list-limits';
import type { Session, SessionData } from '../state/session';
import { useStore } from '../state/use-store';
import type { Comfort } from '../world/comfort';
import { createPlacementHistory } from '../world/placement-history';
import { createPlacementTool, type PlacementActions } from '../world/placement-tool';
import { ProjectInspector } from '../world/ProjectInspector';
import { worldSprite } from '../world/world-assets';
import { createWorldCamera } from '../world/world-camera';
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
  /** Comfort preferences of this window (M2-14): labels, saved cameras, reduced motion. */
  readonly comfort: Comfort;
}

/** Below this width the Atlas + inspector column becomes a drawer (matches app.css). */
const NARROW = '(max-width: 60rem)';
/** Read before the screen has a world (never shown: the screen renders nothing then). */
const EMPTY_PLACEMENTS = createStore<WorldPlacementsState>({
  status: 'loading',
  placements: [],
  error: null,
});

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

function MainLayout({ session, data, notice, comfort }: MainScreenProps) {
  const worldSelectId = useId();
  const sideColumnId = useId();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The project list stays one glance away: it is open when the screen loads.
  const [panel, setPanel] = useState<OpenPanel | null>({ id: 'projects', focus: false });
  /** The library tab last shown, so reopening the library returns to it (M2-9). */
  const [libraryTab, setLibraryTab] = useState<LibraryTabId>('projects');
  const opener = useRef<HTMLElement | null>(null);
  const restoreFocusTo = useRef<HTMLElement | null>(null);

  const narrow = useMediaQuery(NARROW);
  const [drawerOpen, setDrawerOpen] = useState(false);
  /** True while the world canvas is hidden (session only, M2-9). */
  const [worldHidden, setWorldHidden] = useState(false);
  const drawerVisible = narrow && drawerOpen;
  const drawerToggle = useRef<HTMLButtonElement>(null);
  const drawerClose = useRef<HTMLButtonElement>(null);
  /** The Realm Atlas display choices of every world, saved per profile (M2-12, ADR-0031). */
  const [atlasViews] = useState(() => createAtlasViewPreferences(window.atlas.profile));
  const atlasViewsState = useStore(atlasViews.store);
  useEffect(() => {
    void atlasViews.load();
    // A width still waiting for its debounce is saved when the screen goes away.
    const flush = () => void atlasViews.flush();
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [atlasViews]);

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
  // A restored or imported profile can hold more worlds than are listed (#61).
  const worldsNotice = omittedNotice('world', data.worlds.length, data.worldsOmitted);
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
      hotbar: createHotbar(window.atlas, worldId),
      camera: createWorldCamera(),
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
    void scope?.hotbar.refresh();
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
  const { placements, selection, tool, history, camera, hotbar } = scope;
  const atlasView = atlasViewOf(atlasViewsState.views, world.id);
  // The side column's width: the saved width, or the larger expanded size. Each is capped to
  // part of the window so the world always keeps room (app.css reads --side-width).
  const shellStyle = {
    '--side-width': atlasView.expanded
      ? `min(${String(ATLAS_WIDTH_MAX)}px, 60vw)`
      : `min(${String(atlasView.width)}px, 45vw)`,
  } as CSSProperties;

  /** The map actions the Projects list and the inspector offer (M2-7). */
  const placementActions: PlacementActions = {
    place(project) {
      closePanel({ restoreFocus: false });
      setWorldHidden(false);
      tool.startPlacing(project);
    },
    move(project) {
      closePanel({ restoreFocus: false });
      setWorldHidden(false);
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
    // Pins stay, but their names and statuses may have changed.
    void hotbar.refresh();
    setProjectChanges((n) => n + 1);
  }

  /** A hotbar slot's key or click: select its project, or open its service's panel. */
  function activateSlot(entry: HotbarEntry) {
    if (entry.target.type === 'service') {
      openPanel(SERVICE_ENTRANCES[entry.target.id]);
      return;
    }
    selection.select(entry.target.id);
    // In a narrow window the inspector lives in the drawer; show it.
    if (narrow) setDrawerOpen(true);
  }

  /** "Pin to hotbar" in a service panel's header; not for Projects, the library or details. */
  function servicePin(id: PanelId) {
    const service = id === 'library' || id === 'project' ? undefined : serviceOfEntrance(id);
    return service === undefined ? null : <PinServiceToHotbar hotbar={hotbar} service={service} />;
  }

  // A details panel left open for a project of another world is not shown.
  const shownPanel = panel?.id === 'project' && panel.project?.worldId !== world.id ? null : panel;

  function panelContent(id: PanelId) {
    if (world === undefined) return null;
    // The sidebar's Projects panel and the library's Projects tab show the same list.
    const projectList = (
      <ProjectsPanel
        key={world.id}
        world={world}
        placedIds={placedIds}
        onProjectsChanged={projectsChanged}
        changeToken={inspectorChanges}
        placementActions={placementActions}
        onOpenProject={openProject}
        hotbar={hotbar}
      />
    );
    if (id === 'library') {
      return <LibraryPanel tab={libraryTab} onTabChange={setLibraryTab} projects={projectList} />;
    }
    if (id === 'projects') {
      return (
        <>
          {projectList}
          <p className="muted">
            Everything here works offline. AI work will need a model connection later; nothing asks
            for one yet.
          </p>
        </>
      );
    }
    if (id === 'settings')
      return <SettingsView session={session} data={data} world={world} comfort={comfort} />;
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
      <div className="shell" style={shellStyle}>
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
              {worldsNotice !== null && (
                <span className="muted world-omitted" data-testid="worlds-omitted">
                  {worldsNotice}
                </span>
              )}
            </div>
            <div className="profile-chip">
              <PlaceholderAvatar colour={data.settings.avatarColour} size={28} />
              <span data-testid="profile-name">{data.settings.displayName}</span>
            </div>
            <button
              type="button"
              data-testid="world-visibility"
              onClick={() => {
                // An open placement tool has nothing to point at once the map is gone.
                if (!worldHidden) tool.cancel();
                setWorldHidden((hidden) => !hidden);
              }}
            >
              {worldHidden ? 'Show world view' : 'Hide world view'}
            </button>
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
          {worldHidden ? (
            <div className="world-hidden" data-testid="world-hidden">
              <p>The world view is hidden. Nothing about your projects changed.</p>
              <p className="muted">
                Every project action is still available from Projects and the Library (E).
              </p>
            </div>
          ) : (
            <WorldErrorBoundary>
              <WorldView
                key={world.id}
                world={world}
                placements={placements}
                selection={selection}
                tool={tool}
                history={history}
                onOpenProject={openProject}
                comfort={comfort}
                camera={camera}
              />
            </WorldErrorBoundary>
          )}
          {shownPanel !== null && (
            <EntrancePanel
              key={`${shownPanel.id}:${shownPanel.project?.projectId ?? ''}`}
              title={shownPanel.id === 'projects' ? world.name : panelTitle(shownPanel.id)}
              focusOnOpen={shownPanel.focus}
              onClose={closePanel}
              actions={servicePin(shownPanel.id)}
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
          {!atlasView.expanded && (
            <AtlasResizeHandle
              width={atlasView.width}
              onWidth={(width) => void atlasViews.change(world.id, { width })}
            />
          )}
          <RealmAtlasPanel
            key={world.id}
            world={world}
            placements={placements}
            selection={selection}
            camera={camera}
            views={atlasViews}
            tool={tool}
            version={projectChanges}
            comfort={comfort}
          />
          <section className="side-card" aria-labelledby={`${sideColumnId}-inspector`}>
            <h2 id={`${sideColumnId}-inspector`}>Inspector</h2>
            <ProjectInspector
              world={world}
              selection={selection}
              placements={placements}
              version={projectChanges}
              onOpen={openProject}
              placementActions={placementActions}
              hotbar={hotbar}
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
          <Hotbar hotbar={hotbar} onActivate={activateSlot} />
        </footer>
      </div>

      <DeveloperSpikes />
    </>
  );
}
