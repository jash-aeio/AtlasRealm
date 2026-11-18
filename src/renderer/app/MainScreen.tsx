// The screen after onboarding (M1-9 #36): a header with the world, the profile and Settings,
// then the world's home. Until the project list arrives (M1-10 #37) the home is an empty state
// that points to "Create project". The world canvas with real buildings comes in M2.
import { useEffect, useId, useState } from 'react';

import type { WorldSummary } from '../../common/contracts/world';
import { PlaceholderAvatar } from '../onboarding/PlaceholderAvatar';
import type { Session, SessionData } from '../state/session';
import { DeveloperSpikes } from './DeveloperSpikes';
import { SettingsView } from './SettingsView';

interface MainScreenProps {
  readonly session: Session;
  readonly data: SessionData;
  readonly notice: string | null;
}

export function MainScreen({ session, data, notice }: MainScreenProps) {
  const worldSelectId = useId();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<'home' | 'settings'>('home');
  // The screen is only shown with at least one world; fall back to the first if the chosen
  // one is gone (for example archived elsewhere).
  const world = data.worlds.find((w) => w.id === selectedId) ?? data.worlds[0];
  if (world === undefined) return null;

  return (
    <>
      <header className="main-header">
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
          aria-pressed={view === 'settings'}
          onClick={() => {
            setView((v) => (v === 'settings' ? 'home' : 'settings'));
          }}
        >
          {view === 'settings' ? 'Back to world' : 'Settings'}
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

      {view === 'settings' ? (
        <section aria-labelledby="settings-heading">
          <h2 id="settings-heading">Settings</h2>
          <SettingsView session={session} data={data} world={world} />
        </section>
      ) : (
        <WorldHome world={world} />
      )}

      <DeveloperSpikes />
    </>
  );
}

type ProjectPresence = 'checking' | 'none' | 'some' | 'unknown';

function WorldHome({ world }: { readonly world: WorldSummary }) {
  const noteId = useId();
  const [presence, setPresence] = useState<ProjectPresence>('checking');

  // Only claim "no projects" when the main process says so. Projects can already exist
  // through the commands (M1-7) before their list UI lands.
  useEffect(() => {
    let current = true;
    setPresence('checking');
    void window.atlas.project.list({ worldId: world.id, limit: 1 }).then((result) => {
      if (!current) return;
      setPresence(result.ok ? (result.data.projects.length === 0 ? 'none' : 'some') : 'unknown');
    });
    return () => {
      current = false;
    };
  }, [world.id]);

  return (
    <section className="panel world-home" aria-labelledby="world-home-heading">
      <h2 id="world-home-heading">{world.name}</h2>
      <p data-testid="world-empty-state">
        {presence === 'checking' && 'Checking for projects…'}
        {presence === 'none' && 'No projects in this world yet. Create one to get started.'}
        {presence === 'some' &&
          'This world has projects. The project list arrives with the next update (M1-10).'}
        {presence === 'unknown' && 'Could not check for projects right now.'}
      </p>
      <button type="button" className="primary" disabled aria-describedby={noteId}>
        Create project
      </button>
      <p id={noteId} className="muted">
        The project form arrives with the next update (M1-10). The world map with buildings comes
        later (M2).
      </p>
      <p className="muted">
        Everything here works offline. AI work will need a model connection later; nothing asks for
        one yet.
      </p>
    </section>
  );
}
