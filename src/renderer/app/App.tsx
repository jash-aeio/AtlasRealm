import { useEffect, useState } from 'react';

import { Onboarding } from '../onboarding/Onboarding';
import { createSession, screenFor } from '../state/session';
import { useStore } from '../state/use-store';
import { MainScreen } from './MainScreen';

export function App() {
  // One session per window. A profile switch (M1-8) reloads the window, so it never outlives
  // its profile.
  const [session] = useState(() => createSession(window.atlas));
  const state = useStore(session.store);

  useEffect(() => {
    void session.reload();
  }, [session]);

  const screen = screenFor(state);
  return (
    <main className="app" data-screen={screen}>
      <h1>Atlas Realm</h1>
      {state.status === 'loading' && <p role="status">Loading your profile…</p>}
      {state.status === 'error' && (
        <div role="alert" className="error">
          <p>
            Could not read your profile: {state.error.message} ({state.error.code})
          </p>
          <button type="button" onClick={() => void session.reload()}>
            Try again
          </button>
        </div>
      )}
      {state.status === 'ready' &&
        (screen === 'onboarding' ? (
          <Onboarding session={session} data={state.data} />
        ) : (
          <MainScreen session={session} data={state.data} notice={state.notice} />
        ))}
    </main>
  );
}
