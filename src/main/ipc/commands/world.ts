// `world.*` commands (M1-6 #33). They act on the active profile's database only; the router
// has already checked the sender, schema and size before these run.
import { Channels } from '../../../common/contracts/channels';
import {
  MAX_WORLDS,
  WorldCreateInput,
  WorldListInput,
  WorldListOutput,
  WorldOutput,
  WorldRenameInput,
} from '../../../common/contracts/world';
import type { ActiveProfile } from '../../profiles/active-profile';
import { WorldRepository } from '../../storage/repositories/world-repository';
import { withRepositoryErrors } from '../repository-errors';
import { CommandError, type CommandDefinition, type CommandHandler } from '../router';

export const worldCreateCommand = {
  channel: Channels.worldCreate,
  input: WorldCreateInput,
  output: WorldOutput,
} satisfies CommandDefinition<typeof WorldCreateInput, typeof WorldOutput>;

export const worldListCommand = {
  channel: Channels.worldList,
  input: WorldListInput,
  output: WorldListOutput,
} satisfies CommandDefinition<typeof WorldListInput, typeof WorldListOutput>;

export const worldRenameCommand = {
  channel: Channels.worldRename,
  input: WorldRenameInput,
  output: WorldOutput,
} satisfies CommandDefinition<typeof WorldRenameInput, typeof WorldOutput>;

/** Repositories are cheap; a fresh one per call always uses the profile open right now. */
function worlds(active: ActiveProfile): WorldRepository {
  return new WorldRepository(active.current().db);
}

export function createWorldCreateHandler(
  active: ActiveProfile,
): CommandHandler<typeof WorldCreateInput, typeof WorldOutput> {
  return ({ name, themeId }) =>
    withRepositoryErrors(() => {
      const repository = worlds(active);
      // Count and insert run synchronously, so no other command can slip in between them.
      if (repository.list({ includeArchived: true }).length >= MAX_WORLDS) {
        throw new CommandError(
          'limit_reached',
          `This profile already has ${String(MAX_WORLDS)} worlds.`,
        );
      }
      return { world: repository.create({ name, themeId }) };
    });
}

export function createWorldListHandler(
  active: ActiveProfile,
): CommandHandler<typeof WorldListInput, typeof WorldListOutput> {
  return (input) => ({
    worlds: worlds(active).list({ includeArchived: input?.includeArchived ?? false }),
  });
}

export function createWorldRenameHandler(
  active: ActiveProfile,
): CommandHandler<typeof WorldRenameInput, typeof WorldOutput> {
  // An unknown ID (including another profile's world) is `not_found` from the repository.
  return ({ worldId, expectedRevision, name }) =>
    withRepositoryErrors(() => ({
      world: worlds(active).rename(worldId, expectedRevision, name),
    }));
}
