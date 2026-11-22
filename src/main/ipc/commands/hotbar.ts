// `hotbar.*` commands (M2-4 #69). Thin wrappers: the router has already checked the sender,
// schema and size; HotbarService checks the world, the target and the slot's occupant;
// repository errors are mapped to stable command errors on the way out.
import { Channels } from '../../../common/contracts/channels';
import {
  HotbarAssignInput,
  HotbarClearInput,
  HotbarListInput,
  HotbarListOutput,
  HotbarSlotOutput,
} from '../../../common/contracts/hotbar';
import type { HotbarService } from '../../services/hotbar-service';
import { withRepositoryErrors } from '../repository-errors';
import type { CommandDefinition, CommandHandler } from '../router';

export const hotbarListCommand = {
  channel: Channels.hotbarList,
  input: HotbarListInput,
  output: HotbarListOutput,
} satisfies CommandDefinition<typeof HotbarListInput, typeof HotbarListOutput>;

export const hotbarAssignCommand = {
  channel: Channels.hotbarAssign,
  input: HotbarAssignInput,
  output: HotbarSlotOutput,
} satisfies CommandDefinition<typeof HotbarAssignInput, typeof HotbarSlotOutput>;

export const hotbarClearCommand = {
  channel: Channels.hotbarClear,
  input: HotbarClearInput,
  output: HotbarSlotOutput,
} satisfies CommandDefinition<typeof HotbarClearInput, typeof HotbarSlotOutput>;

type Handler<D> = D extends CommandDefinition<infer I, infer O> ? CommandHandler<I, O> : never;

export function createHotbarListHandler(service: HotbarService): Handler<typeof hotbarListCommand> {
  return ({ worldId }) => withRepositoryErrors(() => ({ slots: service.list(worldId) }));
}

export function createHotbarAssignHandler(
  service: HotbarService,
): Handler<typeof hotbarAssignCommand> {
  return (input) => withRepositoryErrors(() => ({ slot: service.assign(input) }));
}

export function createHotbarClearHandler(
  service: HotbarService,
): Handler<typeof hotbarClearCommand> {
  return (input) => withRepositoryErrors(() => ({ slot: service.clear(input) }));
}
