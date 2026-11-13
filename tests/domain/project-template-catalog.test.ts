import { describe, expect, it, vi } from 'vitest';

import {
  MAX_PROJECT_TEMPLATES,
  TemplateListOutput,
  UNREADABLE_TEMPLATE_LOCATION,
} from '../../src/common/contracts/project-template';
import {
  bundledTemplateFiles,
  loadBundledTemplateCatalog,
} from '../../src/main/templates/bundled-templates';
import { buildTemplateCatalog } from '../../src/main/templates/catalog';

const bundled = bundledTemplateFiles();
const generic = bundled['generic/1.0.0'] as Record<string, unknown>;

/** The Generic manifest re-badged as another template at `<folder>/<version>`. */
function variant(folder: string, version = '1.0.0'): Record<string, unknown> {
  return { ...generic, id: `builtin.${folder}`, version };
}

describe('bundled template catalog', () => {
  it('finds both bundled templates through the build-time import', () => {
    expect(Object.keys(bundled).sort()).toEqual(['content-campaign/1.0.0', 'generic/1.0.0']);
  });

  it('loads both as available, with no unavailable entries', () => {
    const log = vi.fn();
    const catalog = loadBundledTemplateCatalog(log);
    expect(catalog.available.map((t) => `${t.id}@${t.version}`)).toEqual([
      'builtin.content-campaign@1.0.0',
      'builtin.generic@1.0.0',
    ]);
    expect(catalog.unavailable).toEqual([]);
    expect(log).not.toHaveBeenCalled();
  });

  it('produces summaries that pass the template.list output schema', () => {
    const { summaries } = loadBundledTemplateCatalog();
    expect(TemplateListOutput.safeParse({ templates: summaries }).success).toBe(true);
    const campaign = summaries.find(
      (s) => s.status === 'available' && s.name === 'Content Campaign',
    );
    expect(campaign).toMatchObject({ metadataOnly: true });
  });
});

describe('buildTemplateCatalog', () => {
  it('reports an invalid template as unavailable and still loads the others', () => {
    const log = vi.fn();
    const catalog = buildTemplateCatalog(
      { 'generic/1.0.0': generic, 'broken/1.0.0': { ...variant('broken'), workflows: [] } },
      log,
    );
    expect(catalog.available.map((t) => t.id)).toEqual(['builtin.generic']);
    expect(catalog.unavailable).toEqual([{ location: 'broken/1.0.0', reason: 'invalid_manifest' }]);
    expect(catalog.summaries.at(-1)).toEqual({
      status: 'unavailable',
      location: 'broken/1.0.0',
      reason: 'invalid_manifest',
    });
    // The Zod details go to the main-process log, not into the summary.
    expect(log).toHaveBeenCalledWith(
      '[templates] "broken/1.0.0" is unavailable: invalid_manifest',
      expect.stringContaining('workflows'),
    );
  });

  it.each([null, 'not json', 42, [], {}])('does not throw on garbage %j', (garbage) => {
    const catalog = buildTemplateCatalog({ 'junk/1.0.0': garbage }, () => undefined);
    expect(catalog.available).toEqual([]);
    expect(catalog.unavailable).toEqual([{ location: 'junk/1.0.0', reason: 'invalid_manifest' }]);
  });

  it.each([
    ['folder name differs from the ID', 'other/1.0.0', variant('generic')],
    ['folder version differs from the manifest', 'generic/2.0.0', variant('generic', '1.0.0')],
    ['location has no version folder', 'generic', variant('generic')],
    ['location is nested deeper', 'a/generic/1.0.0', variant('generic')],
  ])('refuses a template whose %s', (_name, location, manifest) => {
    const catalog = buildTemplateCatalog({ [location]: manifest }, () => undefined);
    expect(catalog.unavailable).toEqual([{ location, reason: 'location_mismatch' }]);
  });

  it.each([
    ['too long', `${'x'.repeat(250)}/1.0.0`],
    ['has a space', 'my template/1.0.0'],
    ['has a control character', 'bad‮name/1.0.0'],
    ['is nested too deep', 'a/b/c/d/1.0.0'],
  ])('hides a location that is %s, without failing the whole list', (_name, location) => {
    const log = vi.fn();
    const catalog = buildTemplateCatalog({ [location]: generic, 'generic/1.0.0': generic }, log);
    expect(catalog.unavailable).toEqual([
      { location: UNREADABLE_TEMPLATE_LOCATION, reason: 'location_mismatch' },
    ]);
    // The good template is still offered, and the list still passes its output schema.
    expect(catalog.available.map((t) => t.id)).toEqual(['builtin.generic']);
    expect(TemplateListOutput.safeParse({ templates: catalog.summaries }).success).toBe(true);
    // The real location is logged, quoted, so control characters can't forge log lines.
    expect(log).toHaveBeenCalledWith(
      `[templates] ${JSON.stringify(location)} is unavailable: location_mismatch`,
      expect.any(String),
    );
  });

  it('accepts several versions of one template', () => {
    const catalog = buildTemplateCatalog(
      { 'generic/1.0.0': generic, 'generic/1.1.0': variant('generic', '1.1.0') },
      () => undefined,
    );
    expect(catalog.available.map((t) => t.version)).toEqual(['1.0.0', '1.1.0']);
  });

  it('caps the catalog and reports the overflow once', () => {
    const files: Record<string, unknown> = {};
    for (let i = 0; i < MAX_PROJECT_TEMPLATES + 5; i += 1) {
      const folder = `t${String(i).padStart(3, '0')}`;
      files[`${folder}/1.0.0`] = variant(folder);
    }
    const catalog = buildTemplateCatalog(files, () => undefined);
    expect(catalog.available).toHaveLength(MAX_PROJECT_TEMPLATES);
    expect(catalog.unavailable).toEqual([
      { location: `t${String(MAX_PROJECT_TEMPLATES)}/1.0.0`, reason: 'too_many_templates' },
    ]);
    expect(TemplateListOutput.safeParse({ templates: catalog.summaries }).success).toBe(true);
  });
});
