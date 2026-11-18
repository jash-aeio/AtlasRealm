// Lists local profiles, renames the active one and creates new ones. Used by onboarding and
// Settings. Switching is shown but disabled until profile switching lands (M1-8 #35).
import { useId, useState } from 'react';

import type { ProfileListOutput } from '../../common/contracts/profile';
import type { CommandOutcome } from '../state/session';
import { commandProblem, nameProblem } from './form-messages';

interface ProfilePickerProps {
  readonly profiles: ProfileListOutput;
  readonly onRename: (displayName: string) => Promise<CommandOutcome>;
  readonly onCreate: (displayName: string) => Promise<CommandOutcome>;
}

export function ProfilePicker({ profiles, onRename, onCreate }: ProfilePickerProps) {
  const switchNoteId = useId();
  const active = profiles.profiles.find((profile) => profile.isActive);
  const hasOthers = profiles.profiles.length > 1;

  return (
    <div className="profile-picker">
      <ul className="profile-list" aria-label="Profiles on this computer">
        {profiles.profiles.map((profile) => (
          <li key={profile.id}>
            <span className="profile-name">{profile.displayName}</span>
            {profile.isActive ? (
              <span className="badge">Active</span>
            ) : (
              <button type="button" disabled aria-describedby={switchNoteId}>
                Switch
              </button>
            )}
          </li>
        ))}
      </ul>
      {hasOthers && (
        <p id={switchNoteId} className="muted">
          Switching profiles arrives with M1-8. Until then the active profile stays in use.
        </p>
      )}
      {active !== undefined && (
        <NameForm
          // Re-mount on a new name, so the field shows what was saved.
          key={active.displayName}
          label="Active profile name"
          initial={active.displayName}
          submitLabel="Rename profile"
          thing="profile"
          onSubmit={onRename}
          successText={(name) => `Renamed to “${name}”.`}
        />
      )}
      <NameForm
        label="New profile name"
        initial=""
        submitLabel="Create profile"
        thing="profile"
        onSubmit={onCreate}
        clearOnSuccess
        successText={(name) =>
          `Created “${name}”. You can switch to it once profile switching arrives (M1-8).`
        }
      />
    </div>
  );
}

interface NameFormProps {
  readonly label: string;
  readonly initial: string;
  readonly submitLabel: string;
  readonly thing: string;
  readonly onSubmit: (name: string) => Promise<CommandOutcome>;
  readonly successText: (name: string) => string;
  readonly clearOnSuccess?: boolean;
}

/** One name field with its own validation and result message. */
export function NameForm({
  label,
  initial,
  submitLabel,
  thing,
  onSubmit,
  successText,
  clearOnSuccess = false,
}: NameFormProps) {
  const inputId = useId();
  const messageId = useId();
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit() {
    const problem = nameProblem(name);
    if (problem !== null) {
      setMessage({ ok: false, text: problem });
      return;
    }
    setBusy(true);
    try {
      const outcome = await onSubmit(name.trim());
      if (outcome.ok) {
        setMessage({ ok: true, text: successText(name.trim()) });
        if (clearOnSuccess) setName('');
      } else {
        setMessage({ ok: false, text: commandProblem(outcome.error, thing) });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="name-form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label htmlFor={inputId}>{label}</label>
      <div className="name-form-row">
        <input
          id={inputId}
          value={name}
          maxLength={200}
          aria-invalid={message !== null && !message.ok}
          aria-describedby={message === null ? undefined : messageId}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <button type="submit" disabled={busy}>
          {submitLabel}
        </button>
      </div>
      {message !== null && (
        <p
          id={messageId}
          role={message.ok ? 'status' : 'alert'}
          className={message.ok ? 'ok' : 'error'}
        >
          {message.text}
        </p>
      )}
    </form>
  );
}
