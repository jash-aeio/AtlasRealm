// `placement.*` commands (M2-3 #68). Thin wrappers: the router has already checked the sender,
// schema and size; PlacementService checks the world, the project and the placement rules;
// repository errors are mapped to stable command errors on the way out.
import { Channels } from '../../../common/contracts/channels';
import {
  PlacementCreateInput,
  PlacementListInput,
  PlacementListOutput,
  PlacementMoveInput,
  PlacementOutput,
  PlacementRemoveInput,
} from '../../../common/contracts/placement';
import type { PlacementService } from '../../services/placement-service';
import { withRepositoryErrors } from '../repository-errors';
import type { CommandDefinition, CommandHandler } from '../router';

export const placementListCommand = {
  channel: Channels.placementList,
  input: PlacementListInput,
  output: PlacementListOutput,
} satisfies CommandDefinition<typeof PlacementListInput, typeof PlacementListOutput>;

export const placementCreateCommand = {
  channel: Channels.placementCreate,
  input: PlacementCreateInput,
  output: PlacementOutput,
} satisfies CommandDefinition<typeof PlacementCreateInput, typeof PlacementOutput>;

export const placementMoveCommand = {
  channel: Channels.placementMove,
  input: PlacementMoveInput,
  output: PlacementOutput,
} satisfies CommandDefinition<typeof PlacementMoveInput, typeof PlacementOutput>;

export const placementRemoveCommand = {
  channel: Channels.placementRemove,
  input: PlacementRemoveInput,
  output: PlacementOutput,
} satisfies CommandDefinition<typeof PlacementRemoveInput, typeof PlacementOutput>;

type Handler<D> = D extends CommandDefinition<infer I, infer O> ? CommandHandler<I, O> : never;

export function createPlacementListHandler(
  service: PlacementService,
): Handler<typeof placementListCommand> {
  return ({ worldId }) => withRepositoryErrors(() => ({ placements: service.list(worldId) }));
}

export function createPlacementCreateHandler(
  service: PlacementService,
): Handler<typeof placementCreateCommand> {
  return (input) => withRepositoryErrors(() => ({ placement: service.create(input) }));
}

export function createPlacementMoveHandler(
  service: PlacementService,
): Handler<typeof placementMoveCommand> {
  return (input) => withRepositoryErrors(() => ({ placement: service.move(input) }));
}

export function createPlacementRemoveHandler(
  service: PlacementService,
): Handler<typeof placementRemoveCommand> {
  return (input) => withRepositoryErrors(() => ({ placement: service.remove(input) }));
}
