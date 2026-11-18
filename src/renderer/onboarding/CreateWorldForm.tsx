// Names a new world and picks its theme. Only bundled themes are offered (ADR-0019).
import { useId, useState } from 'react';

import { DEFAULT_WORLD_THEME, WorldTheme } from '../../common/contracts/world';
import type { CommandOutcome } from '../state/session';
import { commandProblem, nameProblem } from './form-messages';

const THEME_LABELS: Record<WorldTheme, string> = {
  meadow: 'Meadow (default)',
};

interface CreateWorldFormProps {
  readonly onCreate: (name: string, themeId: WorldTheme) => Promise<CommandOutcome>;
}

export function CreateWorldForm({ onCreate }: CreateWorldFormProps) {
  const nameId = useId();
  const themeId = useId();
  const [name, setName] = useState('');
  const [theme, setTheme] = useState<WorldTheme>(DEFAULT_WORLD_THEME);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit() {
    const nameError = nameProblem(name);
    if (nameError !== null) {
      setProblem(nameError);
      return;
    }
    setBusy(true);
    try {
      const outcome = await onCreate(name.trim(), theme);
      setProblem(outcome.ok ? null : commandProblem(outcome.error, 'world'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="create-world"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label htmlFor={nameId}>World name</label>
      <input
        id={nameId}
        value={name}
        maxLength={200}
        placeholder="e.g. My Realm"
        aria-invalid={problem !== null}
        onChange={(event) => {
          setName(event.target.value);
        }}
      />
      <label htmlFor={themeId}>Theme</label>
      <select
        id={themeId}
        value={theme}
        onChange={(event) => {
          setTheme(WorldTheme.parse(event.target.value));
        }}
      >
        {WorldTheme.options.map((option) => (
          <option key={option} value={option}>
            {THEME_LABELS[option]}
          </option>
        ))}
      </select>
      <p className="muted">More themes arrive with more art. You can rename the world later.</p>
      {problem !== null && (
        <p role="alert" className="error">
          {problem}
        </p>
      )}
      <div className="form-actions">
        <button type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create world'}
        </button>
      </div>
    </form>
  );
}
