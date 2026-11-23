// Settings (M1-9 #36): profiles, the avatar (change or remove it after onboarding), the
// current world's name and the comfort options (M2-14 #79, UI_SPEC §6.6).
import { useId } from 'react';

import type { WorldSummary } from '../../common/contracts/world';
import type { ReducedMotionSetting } from '../../common/preferences/comfort';
import { avatarColourLabel } from '../onboarding/avatar';
import { AvatarChooser } from '../onboarding/AvatarChooser';
import { commandProblem } from '../onboarding/form-messages';
import { NameForm, ProfilePicker } from '../onboarding/ProfilePicker';
import { ProfilePrivacyNote } from '../onboarding/ProfilePrivacyNote';
import type { Session, SessionData } from '../state/session';
import { useStore } from '../state/use-store';
import type { Comfort } from '../world/comfort';
import { useMediaQuery } from './use-media-query';
import { OS_REDUCED_MOTION } from './use-reduced-motion';

interface SettingsViewProps {
  readonly session: Session;
  readonly data: SessionData;
  readonly world: WorldSummary;
  readonly comfort: Comfort;
}

export function SettingsView({ session, data, world, comfort }: SettingsViewProps) {
  const colour = data.settings.avatarColour;
  const privacyNoteId = useId();
  return (
    <div className="settings">
      <section
        className="panel"
        aria-labelledby="settings-profiles"
        aria-describedby={privacyNoteId}
      >
        <h3 id="settings-profiles">Profiles</h3>
        <ProfilePrivacyNote id={privacyNoteId} />
        <ProfilePicker
          profiles={data.profiles}
          onRename={session.renameProfile}
          onCreate={session.createProfile}
          onSwitch={session.switchProfile}
        />
      </section>

      <section className="panel" aria-labelledby="settings-avatar">
        <h3 id="settings-avatar">Avatar</h3>
        <p data-testid="avatar-current">
          {colour === null ? 'No avatar chosen.' : `Current: ${avatarColourLabel(colour)}.`}
        </p>
        <AvatarChooser
          savedColour={colour}
          saveLabel="Save avatar"
          onSave={async (next) => {
            const outcome = await session.setAvatar(next);
            return outcome.ok ? null : commandProblem(outcome.error, 'avatar');
          }}
        >
          {colour !== null && (
            <button type="button" onClick={() => void session.setAvatar(null)}>
              Remove avatar
            </button>
          )}
        </AvatarChooser>
      </section>

      <section className="panel" aria-labelledby="settings-world">
        <h3 id="settings-world">World</h3>
        <NameForm
          key={world.id}
          label="World name"
          initial={world.name}
          submitLabel="Rename world"
          thing="world"
          onSubmit={(name) => session.renameWorld(world.id, name)}
          successText={(name) => `Renamed to “${name}”.`}
        />
      </section>

      <ComfortSettings comfort={comfort} />
    </div>
  );
}

const MOTION_CHOICES: readonly { value: ReducedMotionSetting; label: string }[] = [
  { value: 'system', label: 'Follow the Windows setting' },
  { value: 'on', label: 'Reduce motion' },
  { value: 'off', label: 'Full motion' },
];

/** Comfort options. Each change saves straight away; there is no Save button. */
function ComfortSettings({ comfort }: { comfort: Comfort }) {
  const groupName = useId();
  const { status, preferences, error } = useStore(comfort.store);
  const osPrefersReduced = useMediaQuery(OS_REDUCED_MOTION);
  return (
    <section className="panel comfort" aria-labelledby="settings-comfort">
      <h3 id="settings-comfort">Comfort</h3>
      <fieldset>
        <legend>Motion</legend>
        {MOTION_CHOICES.map((choice) => (
          <label key={choice.value} className="comfort-choice">
            <input
              type="radio"
              name={groupName}
              value={choice.value}
              checked={preferences.reducedMotion === choice.value}
              onChange={() => void comfort.setReducedMotion(choice.value)}
            />
            {choice.label}
            {choice.value === 'system' && (
              <span className="muted" data-testid="os-motion">
                {' '}
                (Windows currently asks for {osPrefersReduced ? 'reduced' : 'full'} motion)
              </span>
            )}
          </label>
        ))}
        <p className="muted">
          Reduced motion turns off zoom and pan easing and decorative animation. Atlas Realm
          doesn&apos;t have any yet, so nothing looks different today.
        </p>
      </fieldset>
      <label className="comfort-choice">
        <input
          type="checkbox"
          checked={preferences.buildingLabels}
          onChange={(event) => void comfort.setBuildingLabels(event.target.checked)}
        />
        Show building labels
      </label>
      <p className="muted">
        Saved in this profile. The world also remembers where you left the camera in each world.
      </p>
      {status === 'loading' && <p role="status">Loading comfort settings…</p>}
      {error !== null && (
        <p role="alert" className="error">
          Couldn&apos;t {status === 'error' ? 'read' : 'save'} comfort settings: {error.message}
          {status === 'error' && ' The defaults apply for now.'}
        </p>
      )}
    </section>
  );
}
