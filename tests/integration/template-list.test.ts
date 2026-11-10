import { describe, expect, it } from 'vitest';

import { TemplateListInput, TemplateListOutput } from '../../src/common/contracts/project-template';
import { APP_ENTRY_URL } from '../../src/main/bootstrap/app-origin';
import {
  createTemplateListHandler,
  templateListCommand,
} from '../../src/main/ipc/commands/template-list';
import { createCommandHandler, trustRendererEntry } from '../../src/main/ipc/router';
import { loadBundledTemplateCatalog } from '../../src/main/templates/bundled-templates';
import { buildTemplateCatalog } from '../../src/main/templates/catalog';

const isTrusted = trustRendererEntry(APP_ENTRY_URL);
const trustedSender = { senderFrame: { url: APP_ENTRY_URL, parent: null } };

function listHandler(catalog = loadBundledTemplateCatalog()) {
  return createCommandHandler(templateListCommand, createTemplateListHandler(catalog), isTrusted);
}

describe('template.list input', () => {
  it('accepts no payload', () => {
    expect(TemplateListInput.safeParse(undefined).success).toBe(true);
  });

  it.each([[{}], [null], ['generic'], [{ limit: 1000 }]])('rejects %j', (payload) => {
    expect(TemplateListInput.safeParse(payload).success).toBe(false);
  });
});

describe('template.list through the IPC router', () => {
  it('returns both bundled templates as available summaries', async () => {
    const result = await listHandler()(trustedSender, undefined);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { templates } = TemplateListOutput.parse(result.data);
    expect(templates.map((t) => (t.status === 'available' ? t.id : t.location))).toEqual([
      'builtin.content-campaign',
      'builtin.generic',
    ]);
    // A summary, not the whole manifest: no help texts or per-field limits.
    expect(JSON.stringify(templates)).not.toContain('maxLength');
  });

  it('includes an invalid template as unavailable, without its error details', async () => {
    const catalog = buildTemplateCatalog({ 'broken/1.0.0': { id: '../x' } }, () => undefined);
    const result = await listHandler(catalog)(trustedSender, undefined);
    expect(result).toEqual({
      ok: true,
      data: {
        templates: [
          { status: 'unavailable', location: 'broken/1.0.0', reason: 'invalid_manifest' },
        ],
      },
    });
  });

  it('rejects a payload', async () => {
    const result = await listHandler()(trustedSender, { all: true });
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_payload' } });
  });

  it('rejects a sender that is not our UI', async () => {
    const result = await listHandler()(
      { senderFrame: { url: 'https://evil.example/', parent: null } },
      undefined,
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden_sender' } });
  });
});
