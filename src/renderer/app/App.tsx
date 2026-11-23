import { useEffect, useState } from 'react';

import { Onboarding } from '../onboarding/Onboarding';
import { createSession, screenFor } from '../state/session';
import { useStore } from '../state/use-store';
import { createComfort } from '../world/comfort';
import { MainScreen } from './MainScreen';
import { useMotionAttribute } from './use-reduced-motion';

export function App() {
  // One session per window. A profile switch (M1-8) reloads the window, so it never outlives
  // its profile.
  const [session] = useState(() => createSession(window.atlas));
  const state = useStore(session.store);
  // Comfort preferences (M2-14) are per profile too, and apply to the whole window.
  const [comfort] = useState(() => createComfort(window.atlas.profile));
  useMotionAttribute(comfort);

  useEffect(() => {
    void session.reload();
    void comfort.load();
  }, [session, comfort]);

  const screen = screenFor(state);
  // The main screen puts the title in its own top bar (UI_SPEC §6.1).
  const showsMain = state.status === 'ready' && screen === 'main';
  return (
    <main className="app" data-screen={screen}>
      {!showsMain && <h1>Atlas Realm</h1>}
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
          <MainScreen session={session} data={state.data} notice={state.notice} comfort={comfort} />
        ))}
    </main>
  );
}
