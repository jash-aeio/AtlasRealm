// Lists local profiles, switches between them, renames the active one and creates new ones.
// Used by onboarding and Settings. A successful switch reloads the window (M1-8, ADR-0021).
import { useId, useState } from 'react';

import type { ProfileListOutput } from '../../common/contracts/profile';
import type { CommandOutcome } from '../state/session';
import { commandProblem, nameProblem } from './form-messages';

interface ProfilePickerProps {
  readonly profiles: ProfileListOutput;
  readonly onRename: (displayName: string) => Promise<CommandOutcome>;
  readonly onCreate: (displayName: string) => Promise<CommandOutcome>;
  readonly onSwitch: (profileId: string) => Promise<CommandOutcome>;
}

export function ProfilePicker({ profiles, onRename, onCreate, onSwitch }: ProfilePickerProps) {
  const switchNoteId = useId();
  const active = profiles.profiles.find((profile) => profile.isActive);
  const hasOthers = profiles.profiles.length > 1;
  // The profile being switched to. It stays set on success: the window is about to reload.
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [switchProblem, setSwitchProblem] = useState<string | null>(null);

  async function switchTo(profileId: string) {
    setSwitchingTo(profileId);
    setSwitchProblem(null);
    const outcome = await onSwitch(profileId);
    if (!outcome.ok) {
      setSwitchingTo(null);
      setSwitchProblem(commandProblem(outcome.error, 'profile'));
    }
  }

  return (
    <div className="profile-picker">
      <ul className="profile-list" aria-label="Profiles on this computer">
        {profiles.profiles.map((profile) => (
          <li key={profile.id}>
            <span className="profile-name">{profile.displayName}</span>
            {profile.isActive ? (
              <span className="badge">Active</span>
            ) : (
              <button
                type="button"
                disabled={switchingTo !== null}
                aria-label={`Switch to ${profile.displayName}`}
                aria-describedby={switchNoteId}
                onClick={() => void switchTo(profile.id)}
              >
                {switchingTo === profile.id ? 'Switching…' : 'Switch'}
              </button>
            )}
          </li>
        ))}
      </ul>
      {hasOthers && (
        <p id={switchNoteId} className="muted">
          Switching opens that profile's own worlds and settings. The window reloads; nothing is
          deleted.
        </p>
      )}
      {switchProblem !== null && (
        <p role="alert" className="error">
          {switchProblem}
        </p>
      )}
      {active !== undefined && (
        <NameForm
          key={active.id}
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
        successText={(name) => `Created “${name}”. Use Switch to open it.`}
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
