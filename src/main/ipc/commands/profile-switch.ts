// `profile.switch` (M1-8 #35, ADR-0014). The router has checked the sender, schema and size;
// ProfileSession does the switch and the window reload.
import { Channels } from '../../../common/contracts/channels';
import { ProfileSwitchInput, ProfileSwitchOutput } from '../../../common/contracts/profile';
import type { ProfileSession } from '../../services/profile-session';
import { toProfileId } from '../../storage/profiles/profile-id';
import { withRepositoryErrors } from '../repository-errors';
import type { CommandDefinition, CommandHandler } from '../router';

export const profileSwitchCommand = {
  channel: Channels.profileSwitch,
  input: ProfileSwitchInput,
  output: ProfileSwitchOutput,
} satisfies CommandDefinition<typeof ProfileSwitchInput, typeof ProfileSwitchOutput>;

export function createProfileSwitchHandler(
  session: ProfileSession,
): CommandHandler<typeof ProfileSwitchInput, typeof ProfileSwitchOutput> {
  return ({ profileId }) =>
    withRepositoryErrors(async () => {
      // The contract checked the shape; toProfileId checks it again before it can reach a path.
      const { profileId: active } = await session.switchTo(toProfileId(profileId));
      return { activeProfileId: active, reloading: true as const };
    });
}
