// Picks a colour for the placeholder avatar. Used by the onboarding avatar step and Settings.
// Native radio buttons give keyboard support for free: Tab into the group, arrows to move.
import { useId, useState, type ReactNode } from 'react';

import { AVATAR_COLOURS } from './avatar';
import { PlaceholderAvatar } from './PlaceholderAvatar';

interface AvatarChooserProps {
  /** The saved colour, or null when no avatar is chosen. */
  readonly savedColour: string | null;
  readonly saveLabel: string;
  /** Saves the colour. Resolves to an error message, or null on success. */
  readonly onSave: (colour: string) => Promise<string | null>;
  /** Extra buttons beside Save, such as Skip or Remove avatar. */
  readonly children?: ReactNode;
}

export function AvatarChooser({ savedColour, saveLabel, onSave, children }: AvatarChooserProps) {
  const groupName = useId();
  const [chosen, setChosen] = useState<string>(savedColour ?? AVATAR_COLOURS[0]?.colour ?? '');
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    try {
      setProblem(await onSave(chosen));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="avatar-chooser"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="avatar-preview">
        <PlaceholderAvatar colour={chosen} size={96} />
        <p className="placeholder-label">
          Placeholder avatar: the final character art comes later.
        </p>
      </div>
      <fieldset>
        <legend>Avatar colour</legend>
        <div className="swatches">
          {AVATAR_COLOURS.map((preset) => (
            <label key={preset.colour} className="swatch">
              <input
                type="radio"
                name={groupName}
                value={preset.colour}
                checked={chosen === preset.colour}
                onChange={() => {
                  setChosen(preset.colour);
                }}
              />
              <span className="swatch-chip" style={{ background: preset.colour }} aria-hidden />
              {preset.label}
            </label>
          ))}
        </div>
      </fieldset>
      {problem !== null && (
        <p role="alert" className="error">
          {problem}
        </p>
      )}
      <div className="form-actions">
        <button type="submit" disabled={saving}>
          {saving ? 'Saving…' : saveLabel}
        </button>
        {children}
      </div>
    </form>
  );
}
