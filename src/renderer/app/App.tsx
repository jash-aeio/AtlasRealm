import { useState } from 'react';

import type { PingOutput } from '../../common/contracts/app-ping';
import type { IpcResult } from '../../common/contracts/ipc-result';

export function App() {
  const [message, setMessage] = useState('hello from the renderer');
  const [result, setResult] = useState<IpcResult<PingOutput> | null>(null);

  async function sendPing() {
    setResult(await window.atlas.app.ping({ message }));
  }

  return (
    <main className="app">
      <h1>Atlas Realm</h1>
      <p className="muted">M0 shell. No world, projects or data yet.</p>

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
