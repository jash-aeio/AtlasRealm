import { describe, expect, it } from 'vitest';

import { PingInput, PingOutput } from '../../src/common/contracts/app-ping';
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

// TODO(you): implement these rules in src/common/contracts/app-ping.ts, then change
// `describe.skip` to `describe` and run `pnpm test`. All of them should pass.
describe.skip('app.ping input rules (your schema)', () => {
  it('trims surrounding whitespace', () => {
    expect(PingInput.parse({ message: '  hi  ' })).toEqual({ message: 'hi' });
  });

  it.each([[''], ['   ']])('rejects an empty or whitespace-only message (%j)', (message) => {
    expect(PingInput.safeParse({ message }).success).toBe(false);
  });

  it('accepts 200 characters and rejects 201', () => {
    expect(PingInput.safeParse({ message: 'x'.repeat(200) }).success).toBe(true);
    expect(PingInput.safeParse({ message: 'x'.repeat(201) }).success).toBe(false);
  });

  it('rejects unknown keys instead of silently dropping them', () => {
    expect(PingInput.safeParse({ message: 'hi', isAdmin: true }).success).toBe(false);
  });
});
