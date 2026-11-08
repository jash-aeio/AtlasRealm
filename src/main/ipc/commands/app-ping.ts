import { PingInput, PingOutput } from '../../../common/contracts/app-ping';
import { Channels } from '../../../common/contracts/channels';
import type { CommandDefinition, CommandHandler } from '../router';

export const appPingCommand = {
  channel: Channels.appPing,
  input: PingInput,
  output: PingOutput,
} satisfies CommandDefinition<typeof PingInput, typeof PingOutput>;

/** M0 spike handler: echoes the message so the round-trip is visible in the UI and tests. */
export const handleAppPing: CommandHandler<typeof PingInput, typeof PingOutput> = ({
  message,
}) => ({
  reply: `pong: ${message}`,
  receivedAt: new Date().toISOString(),
});
