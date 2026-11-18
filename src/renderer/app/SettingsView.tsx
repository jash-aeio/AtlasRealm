// Settings (M1-9 #36): profiles, the avatar (change or remove it after onboarding) and the
// current world's name.
import type { WorldSummary } from '../../common/contracts/world';
import { avatarColourLabel } from '../onboarding/avatar';
import { AvatarChooser } from '../onboarding/AvatarChooser';
import { commandProblem } from '../onboarding/form-messages';
import { NameForm, ProfilePicker } from '../onboarding/ProfilePicker';
import type { Session, SessionData } from '../state/session';

interface SettingsViewProps {
  readonly session: Session;
  readonly data: SessionData;
  readonly world: WorldSummary;
}

export function SettingsView({ session, data, world }: SettingsViewProps) {
  const colour = data.settings.avatarColour;
  return (
    <div className="settings">
      <section className="panel" aria-labelledby="settings-profiles">
        <h3 id="settings-profiles">Profiles</h3>
        <ProfilePicker
          profiles={data.profiles}
          onRename={session.renameProfile}
          onCreate={session.createProfile}
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
    </div>
  );
}
