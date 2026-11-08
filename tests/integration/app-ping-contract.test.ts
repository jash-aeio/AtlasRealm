import { describe, expect, it } from 'vitest';

import {
  PING_MESSAGE_MAX_LENGTH,
  PingInput,
  PingOutput,
} from '../../src/common/contracts/app-ping';
import { handleAppPing } from '../../src/main/ipc/commands/app-ping';

describe('app.ping contract (baseline)', () => {
  it('accepts a plain message', () => {
    expect(PingInput.safeParse({ message: 'hello' }).success).toBe(true);
  });

  it.each([[{ message: 42 }], [{}], ['hello'], [null]])('rejects %j', (payload) => {
    expect(PingInput.safeParse(payload).success).toBe(false);
  });

  it('handler output satisfies PingOutput', async () => {
    const output = await handleAppPing({ message: 'hi' });
    expect(PingOutput.parse(output)).toMatchObject({ reply: 'pong: hi' });
  });
});

describe('app.ping input rules', () => {
  it('trims surrounding whitespace', () => {
    expect(PingInput.parse({ message: '  hi  ' })).toEqual({ message: 'hi' });
  });

  it.each([[''], ['   ']])('rejects an empty or whitespace-only message (%j)', (message) => {
    expect(PingInput.safeParse({ message }).success).toBe(false);
  });

  it('accepts the max length and rejects one more', () => {
    expect(PingInput.safeParse({ message: 'x'.repeat(PING_MESSAGE_MAX_LENGTH) }).success).toBe(
      true,
    );
    expect(PingInput.safeParse({ message: 'x'.repeat(PING_MESSAGE_MAX_LENGTH + 1) }).success).toBe(
      false,
    );
  });

  it('rejects unknown keys instead of silently dropping them', () => {
    expect(PingInput.safeParse({ message: 'hi', isAdmin: true }).success).toBe(false);
  });
});
