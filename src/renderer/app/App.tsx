import { useEffect, useState } from 'react';

import type { LaunchInfoOutput } from '../../common/contracts/app-launch-info';
import type { PingOutput } from '../../common/contracts/app-ping';
import type { IpcResult } from '../../common/contracts/ipc-result';
import { RealmAtlasPanel } from '../atlas/RealmAtlasPanel';
import { WorldCanvas } from '../world/WorldCanvas';
import { WorldErrorBoundary } from '../world/WorldErrorBoundary';

export function App() {
  const [message, setMessage] = useState('hello from the renderer');
  const [result, setResult] = useState<IpcResult<PingOutput> | null>(null);
  const [launch, setLaunch] = useState<IpcResult<LaunchInfoOutput> | null>(null);
  const [showWorld, setShowWorld] = useState(true);

  useEffect(() => {
    void window.atlas.app.launchInfo().then(setLaunch);
  }, []);

  async function sendPing() {
    setResult(await window.atlas.app.ping({ message }));
  }

  return (
    <main className="app">
      <h1>Atlas Realm</h1>
      <p className="muted">
        M0 shell. The world is a placeholder grid and the Realm Atlas shows mock entities; no real
        projects yet.
      </p>

      <button
        type="button"
        aria-pressed={!showWorld}
        onClick={() => {
          setShowWorld((shown) => !shown);
        }}
      >
        {showWorld ? 'Hide world view' : 'Show world view'}
      </button>
      <div className="workspace">
        <div className="workspace-main">
          {showWorld && (
            <WorldErrorBoundary>
              <WorldCanvas />
            </WorldErrorBoundary>
          )}
        </div>
        <RealmAtlasPanel />
      </div>

      <section className="panel" aria-labelledby="storage-heading">
        <h2 id="storage-heading">Local database (M0 sample data)</h2>
        <output data-testid="launch-info" className={launch?.ok === false ? 'error' : 'ok'}>
          {launch === null
            ? 'Reading…'
            : launch.ok
              ? `Launch #${String(launch.data.launchCount)} · first launched ${launch.data.firstLaunchedAt} · schema v${String(launch.data.schemaVersion)}`
              : `${launch.error.code}: ${launch.error.message}`}
        </output>
      </section>

      <section className="panel" aria-labelledby="ipc-heading">
        <h2 id="ipc-heading">IPC check (M0 spike)</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void sendPing();
          }}
        >
          <label>
            Message{' '}
            <input
              value={message}
              onChange={(event) => {
                setMessage(event.target.value);
              }}
            />
          </label>{' '}
          <button type="submit">Send app.ping</button>
        </form>
        {result !== null && (
          <output data-testid="ping-result" className={result.ok ? 'ok' : 'error'}>
            {result.ok
              ? `${result.data.reply} (main process, ${result.data.receivedAt})`
              : `${result.error.code}: ${result.error.message}`}
          </output>
        )}
      </section>
    </main>
  );
}
