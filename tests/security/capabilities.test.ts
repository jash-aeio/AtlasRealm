// Capability registry (M3-1 #111, SECURITY §13.1).
import { describe, expect, it } from 'vitest';

import * as capabilities from '../../src/common/security/capabilities';
import {
  CAPABILITIES,
  CapabilityId,
  describeCapability,
  isCapabilityAvailable,
  isScopeAllowed,
} from '../../src/common/security/capabilities';

// SECURITY §13.1, copied by hand so a change to the registry has to be made on purpose.
const SPEC_IDS = [
  'project.files.list',
  'project.files.read',
  'project.artifacts.write',
  'external.files.read',
  'external.files.write',
  'external.files.delete',
  'provider.request',
  'network.fetch',
  'application.document.create',
  'application.document.edit',
  'application.ui.control',
  'external.message.send',
  'external.content.publish',
  'process.execute',
  'graph.source.index',
  'project.import.inspect',
  'project.import.copy',
  'obsidian.notes.export',
  'obsidian.notes.index',
  'obsidian.note.open',
  'asset.generation.request',
];

const M3_IDS = [
  'project.files.list',
  'project.files.read',
  'project.artifacts.write',
  'project.import.inspect',
  'project.import.copy',
  'graph.source.index',
];

describe('capability registry', () => {
  it('knows exactly the §13.1 IDs, each once', () => {
    expect([...CapabilityId.options].sort()).toEqual([...SPEC_IDS].sort());
    expect(Object.keys(CAPABILITIES).sort()).toEqual([...SPEC_IDS].sort());
  });

  it('marks exactly the six M3 capabilities as available', () => {
    const available = CapabilityId.options.filter((id) => isCapabilityAvailable(id));
    expect(available.sort()).toEqual([...M3_IDS].sort());
  });

  it.each(CapabilityId.options)('%s has a label, a risk note and at least one scope', (id) => {
    const info = describeCapability(id);
    expect(info.label.length).toBeGreaterThan(5);
    expect(info.riskNote.length).toBeGreaterThan(5);
    expect(info.scopes.length).toBeGreaterThan(0);
    // Labels are for people: the internal ID must not leak into them.
    expect(info.label).not.toContain(id);
  });

  it('refuses unknown or near-miss IDs', () => {
    for (const id of [
      'project.files.delete',
      'Project.Files.Read',
      'shell.run',
      '',
      ' project.files.read',
    ]) {
      expect(CapabilityId.safeParse(id).success).toBe(false);
    }
  });

  it('keeps import capabilities on the import session and project ones on the project', () => {
    expect(isScopeAllowed('project.import.copy', 'import-session')).toBe(true);
    expect(isScopeAllowed('project.import.copy', 'selected-project')).toBe(false);
    expect(isScopeAllowed('project.files.read', 'selected-project')).toBe(true);
    expect(isScopeAllowed('project.files.read', 'selected-external-folder')).toBe(false);
  });

  it('offers no way to create a grant', () => {
    // §13.2: installing or declaring never grants access. Grants belong to the broker (M3-10).
    for (const name of Object.keys(capabilities)) {
      expect(name).not.toMatch(/grant|authori[sz]e|allow(?!ed)/i);
    }
  });
});
