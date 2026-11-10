import { useEffect, useState } from 'react';

import type { IpcResult } from '../../common/contracts/ipc-result';
import type { WorkerCheckOutput, WorkerStatusOutput } from '../../common/contracts/runtime-worker';

// M0 spike panel (issue #9): shows the background worker's real state as reported by the main
// process. The status is a snapshot, not live: it refreshes on load and when you ask.

function describeStatus(status: IpcResult<WorkerStatusOutput> | null): string {
  if (status === null) return 'Reading…';
  if (!status.ok) return `${status.error.code}: ${status.error.message}`;
  const s = status.data;
  const parts = [`Worker ${s.state}`];
  if (s.pid !== null) parts.push(`pid ${String(s.pid)}`);
  parts.push(`crashes ${String(s.crashCount)}`);
  if (s.lastExitCode !== null) parts.push(`last exit code ${String(s.lastExitCode)}`);
  parts.push(`as of ${new Date(s.checkedAt).toLocaleTimeString()}`);
  return parts.join(' · ');
}

function describeCheck(check: IpcResult<WorkerCheckOutput>): string {
  if (!check.ok) return `${check.error.code}: ${check.error.message}`;
  const { echo, cancel } = check.data;
  const echoText =
    echo.outcome === 'ok'
      ? `echo ok in ${echo.roundTripMs.toFixed(1)} ms`
      : `echo failed (${echo.outcome})`;
  const cancelText =
    cancel.outcome === 'cancelled'
      ? `slow count cancelled after ${String(cancel.cancelledAfterMs)} ms, ` +
        `${String(cancel.activeAfterCancel ?? '?')} still running`
      : `cancel did not work (${cancel.outcome})`;
  return `${echoText} · ${cancelText}`;
}

export function WorkerPanel() {
  const [status, setStatus] = useState<IpcResult<WorkerStatusOutput> | null>(null);
  const [check, setCheck] = useState<IpcResult<WorkerCheckOutput> | null>(null);
  const [running, setRunning] = useState(false);

  async function refreshStatus() {
    setStatus(await window.atlas.runtime.workerStatus());
  }

  async function runCheck() {
    setRunning(true);
    try {
      const result = await window.atlas.runtime.workerCheck();
      setCheck(result);
      if (result.ok) setStatus({ ok: true, data: result.data.status });
      else await refreshStatus();
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    void refreshStatus();
  }, []);

  const crashed = status?.ok === true && status.data.state === 'crashed';
  return (
    <section className="panel" aria-labelledby="worker-heading">
      <h2 id="worker-heading">Worker check (M0 spike)</h2>
      <output
        data-testid="worker-status"
        className={crashed || status?.ok === false ? 'error' : 'ok'}
      >
        {describeStatus(status)}
      </output>
      <p>
        <button type="button" onClick={() => void refreshStatus()}>
          Refresh worker status
        </button>{' '}
        <button type="button" disabled={running} onClick={() => void runCheck()}>
          {running ? 'Running worker check…' : 'Run worker check'}
        </button>
      </p>
      {check !== null && (
        <output
          data-testid="worker-check"
          className={check.ok && check.data.cancel.outcome === 'cancelled' ? 'ok' : 'error'}
        >
          {describeCheck(check)}
        </output>
      )}
    </section>
  );
}
