// `graph.*` commands (M2-11 #76, ADR-0029). Read-only: the router has already checked the
// sender, schema and size, and GraphService builds the bounded graph.
import { Channels } from '../../../common/contracts/channels';
import {
  GraphWorldConnectionsInput,
  GraphWorldConnectionsOutput,
} from '../../../common/contracts/graph';
import type { GraphService } from '../../services/graph-service';
import { withRepositoryErrors } from '../repository-errors';
import type { CommandDefinition, CommandHandler } from '../router';

export const graphWorldConnectionsCommand = {
  channel: Channels.graphWorldConnections,
  input: GraphWorldConnectionsInput,
  output: GraphWorldConnectionsOutput,
} satisfies CommandDefinition<
  typeof GraphWorldConnectionsInput,
  typeof GraphWorldConnectionsOutput
>;

type Handler<D> = D extends CommandDefinition<infer I, infer O> ? CommandHandler<I, O> : never;

export function createGraphWorldConnectionsHandler(
  service: GraphService,
): Handler<typeof graphWorldConnectionsCommand> {
  return ({ worldId }) => withRepositoryErrors(() => service.worldConnections(worldId));
}
