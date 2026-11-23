// `relation.*` commands (M2-11 #76, ADR-0029). Thin wrappers: the router has already checked
// the sender, schema and size; GraphService checks the world, the projects and the link;
// repository errors are mapped to stable command errors on the way out.
import { Channels } from '../../../common/contracts/channels';
import {
  RelationCreateInput,
  RelationOutput,
  RelationRemoveInput,
} from '../../../common/contracts/relation';
import type { GraphService } from '../../services/graph-service';
import { withRepositoryErrors } from '../repository-errors';
import type { CommandDefinition, CommandHandler } from '../router';

export const relationCreateCommand = {
  channel: Channels.relationCreate,
  input: RelationCreateInput,
  output: RelationOutput,
} satisfies CommandDefinition<typeof RelationCreateInput, typeof RelationOutput>;

export const relationRemoveCommand = {
  channel: Channels.relationRemove,
  input: RelationRemoveInput,
  output: RelationOutput,
} satisfies CommandDefinition<typeof RelationRemoveInput, typeof RelationOutput>;

type Handler<D> = D extends CommandDefinition<infer I, infer O> ? CommandHandler<I, O> : never;

export function createRelationCreateHandler(
  service: GraphService,
): Handler<typeof relationCreateCommand> {
  return (input) => withRepositoryErrors(() => ({ relation: service.create(input) }));
}

export function createRelationRemoveHandler(
  service: GraphService,
): Handler<typeof relationRemoveCommand> {
  return (input) => withRepositoryErrors(() => ({ relation: service.remove(input) }));
}
