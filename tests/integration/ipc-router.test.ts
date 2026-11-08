import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  createCommandHandler,
  MAX_PAYLOAD_BYTES,
  trustRendererEntry,
  type InvokeSender,
} from '../../src/main/ipc/router';

const ENTRY = 'file:///C:/Program%20Files/Atlas%20Realm/out/renderer/index.html';
const isTrusted = trustRendererEntry(ENTRY);

function senderAt(url: string, parent: unknown = null): InvokeSender {
  return { senderFrame: { url, parent } };
}
const trustedSender = senderAt(ENTRY);

// A test-only command, so these tests don't depend on app.ping's schema.
const echo = {
  channel: 'app.ping',
  input: z.strictObject({ text: z.string().max(10) }),
  output: z.strictObject({ echoed: z.string() }),
} as const;

describe('createCommandHandler', () => {
  it('runs the handler and returns ok for a valid payload from our UI', async () => {
    const handle = createCommandHandler(echo, ({ text }) => ({ echoed: text }), isTrusted);
    await expect(handle(trustedSender, { text: 'hi' })).resolves.toEqual({
      ok: true,
      data: { echoed: 'hi' },
    });
  });

  it.each([
    ['wrong type', { text: 42 }],
    ['missing field', {}],
    ['extra field', { text: 'hi', admin: true }],
    ['not an object', 'hi'],
    ['no payload', undefined],
    ['schema limit exceeded', { text: 'x'.repeat(11) }],
  ])('rejects an invalid payload (%s) without calling the handler', async (_label, payload) => {
    const handler = vi.fn(() => ({ echoed: 'never' }));
    const handle = createCommandHandler(echo, handler, isTrusted);

    const result = await handle(trustedSender, payload);

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_payload' } });
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects a schema-valid payload that is over the size limit', async () => {
    const handler = vi.fn(() => ({ echoed: 'never' }));
    const unbounded = { ...echo, input: z.strictObject({ text: z.string() }) };
    const handle = createCommandHandler(unbounded, handler, isTrusted);

    const result = await handle(trustedSender, { text: 'x'.repeat(MAX_PAYLOAD_BYTES) });

    expect(result).toMatchObject({ ok: false, error: { code: 'payload_too_large' } });
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects a huge binary payload by shape, without serializing it', async () => {
    const handle = createCommandHandler(echo, () => ({ echoed: '' }), isTrusted);
    const stringify = vi.spyOn(JSON, 'stringify');

    const result = await handle(trustedSender, new Uint8Array(10 * 1024 * 1024));

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_payload' } });
    expect(stringify).not.toHaveBeenCalled();
    stringify.mockRestore();
  });

  it('rejects data that is not JSON-serializable', async () => {
    const loose = { ...echo, input: z.strictObject({ text: z.unknown() }) };
    const handle = createCommandHandler(loose, () => ({ echoed: '' }), isTrusted);
    await expect(handle(trustedSender, { text: 1n })).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_payload' },
    });
  });

  it('rejects a forged request from an untrusted sender', async () => {
    const handler = vi.fn(() => ({ echoed: 'never' }));
    const handle = createCommandHandler(echo, handler, isTrusted);

    const result = await handle(senderAt('https://evil.example/'), { text: 'hi' });

    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden_sender' } });
    expect(handler).not.toHaveBeenCalled();
  });

  it('hides handler errors behind internal_error and keeps details out of the result', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const handle = createCommandHandler(
      echo,
      () => {
        throw new Error('secret internal detail');
      },
      isTrusted,
    );

    const result = await handle(trustedSender, { text: 'hi' });

    expect(result).toMatchObject({ ok: false, error: { code: 'internal_error' } });
    expect(JSON.stringify(result)).not.toContain('secret internal detail');
    consoleError.mockRestore();
  });

  it('treats a handler output that breaks the contract as internal_error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // Simulates a buggy handler: the cast hides the wrong shape from the type checker.
    const buggy = (() => ({ wrong: 1 })) as unknown as () => { echoed: string };
    const handle = createCommandHandler(echo, buggy, isTrusted);

    await expect(handle(trustedSender, { text: 'hi' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'internal_error' },
    });
    consoleError.mockRestore();
  });
});

describe('trustRendererEntry', () => {
  it('trusts only the exact built index.html (query and hash ignored)', () => {
    expect(isTrusted(senderAt(ENTRY))).toBe(true);
    expect(isTrusted(senderAt(`${ENTRY}#/world`))).toBe(true);
    expect(isTrusted(senderAt('file:///C:/Users/me/Downloads/evil.html'))).toBe(false);
  });

  it('rejects a UNC (network share) URL even when its path matches', () => {
    const unc = ENTRY.replace('file:///', 'file://attacker/');
    expect(new URL(unc).pathname).toBe(new URL(ENTRY).pathname);
    expect(isTrusted(senderAt(unc))).toBe(false);
  });

  it('rejects subframes, missing frames and unparseable URLs', () => {
    expect(isTrusted(senderAt(ENTRY, { url: ENTRY }))).toBe(false);
    expect(isTrusted({ senderFrame: null })).toBe(false);
    expect(isTrusted(senderAt('not a url'))).toBe(false);
  });

  it('matches the dev server by origin', () => {
    const dev = trustRendererEntry('http://localhost:5173/');
    expect(dev(senderAt('http://localhost:5173/index.html'))).toBe(true);
    expect(dev(senderAt('http://localhost:5174/'))).toBe(false);
    expect(dev(senderAt('http://127.0.0.1:5173/'))).toBe(false);
  });
});
