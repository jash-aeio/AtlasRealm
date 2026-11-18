// The M0 spike panels, kept for developers under a collapsed section (M1-9 #36). Everything in
// here is mock data or a spike command with no product meaning, and is labelled as such.
// The contents mount only while the section is open, so the Pixi world and the worker checks
// don't run inside a hidden box.
import { useEffect, useState } from 'react';

import type { LaunchInfoOutput } from '../../common/contracts/app-launch-info';
import type { PingOutput } from '../../common/contracts/app-ping';
import type { IpcResult } from '../../common/contracts/ipc-result';
import { RealmAtlasPanel } from '../atlas/RealmAtlasPanel';
import { WorldCanvas } from '../world/WorldCanvas';
import { WorldErrorBoundary } from '../world/WorldErrorBoundary';
import { WorkerPanel } from './WorkerPanel';

export function DeveloperSpikes() {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="developer-spikes"
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
      }}
    >
      <summary>Developer spikes (M0 mock data, not your projects)</summary>
      {open && <SpikePanels />}
    </details>
  );
}

function SpikePanels() {
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
    <div className="spike-panels">
      <p className="muted">
        M0 spikes. The world is a placeholder grid and the Realm Atlas shows mock entities; none of
        it is connected to your profile, worlds or projects.
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

      <WorkerPanel />
    </div>
  );
}
