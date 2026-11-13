// `profile.*` and `profile.settings.*` commands (M1-6 #33). All of them act on the active
// profile; the router has already checked the sender, schema and size before these run.
import { Channels } from '../../../common/contracts/channels';
import {
  ProfileCreateInput,
  ProfileCreateOutput,
  ProfileListInput,
  ProfileListOutput,
  ProfileRenameInput,
  ProfileSettingsGetInput,
  ProfileSettingsOutput,
  type ProfileSettings as ProfileSettingsDto,
  ProfileSettingsUpdateInput,
} from '../../../common/contracts/profile';
import type { ProfileService } from '../../profiles/profile-service';
import type { ProfileSettings } from '../../storage/repositories/profile-settings-repository';
import { withRepositoryErrors } from '../repository-errors';
import type { CommandDefinition, CommandHandler } from '../router';

export const profileListCommand = {
  channel: Channels.profileList,
  input: ProfileListInput,
  output: ProfileListOutput,
} satisfies CommandDefinition<typeof ProfileListInput, typeof ProfileListOutput>;

export const profileCreateCommand = {
  channel: Channels.profileCreate,
  input: ProfileCreateInput,
  output: ProfileCreateOutput,
} satisfies CommandDefinition<typeof ProfileCreateInput, typeof ProfileCreateOutput>;

export const profileRenameCommand = {
  channel: Channels.profileRename,
  input: ProfileRenameInput,
  output: ProfileSettingsOutput,
} satisfies CommandDefinition<typeof ProfileRenameInput, typeof ProfileSettingsOutput>;

export const profileSettingsGetCommand = {
  channel: Channels.profileSettingsGet,
  input: ProfileSettingsGetInput,
  output: ProfileSettingsOutput,
} satisfies CommandDefinition<typeof ProfileSettingsGetInput, typeof ProfileSettingsOutput>;

export const profileSettingsUpdateCommand = {
  channel: Channels.profileSettingsUpdate,
  input: ProfileSettingsUpdateInput,
  output: ProfileSettingsOutput,
} satisfies CommandDefinition<typeof ProfileSettingsUpdateInput, typeof ProfileSettingsOutput>;

/**
 * Only the fields the contract lists. Preferences stay in the main process until a later
 * milestone gives them a schema. The output schema then checks values such as the avatar preset.
 */
function toDto(settings: ProfileSettings): { settings: ProfileSettingsDto } {
  return {
    settings: {
      profileId: settings.profileId,
      displayName: settings.displayName,
      avatarPreset: settings.avatarPreset as ProfileSettingsDto['avatarPreset'],
      avatarColour: settings.avatarColour,
      timezone: settings.timezone,
      createdAt: settings.createdAt,
      updatedAt: settings.updatedAt,
      revision: settings.revision,
    },
  };
}

export function createProfileListHandler(
  service: ProfileService,
): CommandHandler<typeof ProfileListInput, typeof ProfileListOutput> {
  return () => {
    const { profiles, activeProfileId } = service.list();
    return {
      profiles: profiles.map(({ id, displayName, isActive }) => ({ id, displayName, isActive })),
      activeProfileId,
    };
  };
}

export function createProfileCreateHandler(
  service: ProfileService,
): CommandHandler<typeof ProfileCreateInput, typeof ProfileCreateOutput> {
  return ({ displayName }) =>
    withRepositoryErrors(async () => {
      const { id } = await service.create(displayName);
      return { profile: { id, displayName, isActive: false } };
    });
}

export function createProfileRenameHandler(
  service: ProfileService,
): CommandHandler<typeof ProfileRenameInput, typeof ProfileSettingsOutput> {
  return ({ displayName, expectedRevision }) =>
    withRepositoryErrors(async () => toDto(await service.rename(displayName, expectedRevision)));
}

export function createProfileSettingsGetHandler(
  service: ProfileService,
): CommandHandler<typeof ProfileSettingsGetInput, typeof ProfileSettingsOutput> {
  return () => toDto(service.getSettings());
}

export function createProfileSettingsUpdateHandler(
  service: ProfileService,
): CommandHandler<typeof ProfileSettingsUpdateInput, typeof ProfileSettingsOutput> {
  return ({ expectedRevision, ...patch }) =>
    withRepositoryErrors(() => toDto(service.updateSettings(expectedRevision, patch)));
}
