import { describe, expect, it } from 'vitest';

import {
  defaultExclusion,
  exclusionFor,
  isIgnoredByGitignore,
  parseGitignore,
} from '../../src/main/import/exclusions';

describe('built-in exclusions (IMPORT_SPEC §33.6)', () => {
  it.each([
    ['node_modules', 'dependencies'],
    ['NODE_MODULES', 'dependencies'],
    ['.venv', 'dependencies'],
    ['.git', 'version_control'],
    ['dist', 'build_output'],
    ['__pycache__', 'cache'],
    ['tmp', 'temporary'],
    ['.obsidian', 'obsidian_internals'],
  ])('excludes the folder %s as %s', (name, rule) => {
    expect(defaultExclusion(name, 'folder')).toBe(rule);
  });

  it.each([
    ['.env', 'environment_file'],
    ['.env.local', 'environment_file'],
    ['.ENV.production', 'environment_file'],
    ['.envrc', 'environment_file'],
    ['id_rsa', 'private_key'],
    ['id_ed25519.pub', 'private_key'],
    ['server.pem', 'private_key'],
    ['signing.PFX', 'private_key'],
    ['putty.ppk', 'private_key'],
    ['.npmrc', 'credentials_file'],
    ['.git-credentials', 'credentials_file'],
    ['Thumbs.db', 'system_file'],
    ['report.tmp', 'temporary'],
    ['~$brief.docx', 'temporary'],
  ])('excludes the file %s as %s', (name, rule) => {
    expect(defaultExclusion(name, 'file')).toBe(rule);
  });

  it.each([['brief.md'], ['environment.md'], ['keynote.key.md'], ['dist.txt'], ['build.md']])(
    'keeps the ordinary file %s',
    (name) => {
      expect(defaultExclusion(name, 'file')).toBeUndefined();
    },
  );

  it('only treats folder names as folder rules', () => {
    expect(defaultExclusion('build', 'file')).toBeUndefined();
    expect(defaultExclusion('drafts', 'folder')).toBeUndefined();
  });
});

describe('parseGitignore and isIgnoredByGitignore', () => {
  const ignored = (text: string, path: string, kind: 'file' | 'folder' = 'file', base = '') =>
    isIgnoredByGitignore(parseGitignore(text, base).rules, path, kind);

  it('matches a plain name at any depth', () => {
    expect(ignored('notes.txt', 'notes.txt')).toBe(true);
    expect(ignored('notes.txt', 'a/b/notes.txt')).toBe(true);
    expect(ignored('notes.txt', 'a/notes.txt.bak')).toBe(false);
  });

  it('handles * and ? inside one name only', () => {
    expect(ignored('*.log', 'logs/today.log')).toBe(true);
    expect(ignored('*.log', 'logs/today.log.txt')).toBe(false);
    expect(ignored('draft?.md', 'draft1.md')).toBe(true);
    expect(ignored('draft?.md', 'draft10.md')).toBe(false);
  });

  it('anchors a pattern that contains a slash', () => {
    expect(ignored('/out.md', 'out.md')).toBe(true);
    expect(ignored('/out.md', 'sub/out.md')).toBe(false);
    expect(ignored('docs/*.pdf', 'docs/a.pdf')).toBe(true);
    expect(ignored('docs/*.pdf', 'docs/x/a.pdf')).toBe(false);
    expect(ignored('docs/*.pdf', 'other/docs/a.pdf')).toBe(false);
  });

  it('handles ** across folders', () => {
    expect(ignored('**/secret', 'secret')).toBe(true);
    expect(ignored('**/secret', 'a/b/secret')).toBe(true);
    expect(ignored('assets/**', 'assets/a/b.png')).toBe(true);
    expect(ignored('a/**/z.md', 'a/z.md')).toBe(true);
    expect(ignored('a/**/z.md', 'a/b/c/z.md')).toBe(true);
  });

  it('matches folders only when the pattern ends with /', () => {
    expect(ignored('exports/', 'exports', 'folder')).toBe(true);
    expect(ignored('exports/', 'exports', 'file')).toBe(false);
  });

  it('lets a later ! line re-include, last match wins', () => {
    const text = '*.md\n!keep.md';
    expect(ignored(text, 'drop.md')).toBe(true);
    expect(ignored(text, 'keep.md')).toBe(false);
    expect(ignored('!keep.md\n*.md', 'keep.md')).toBe(true);
  });

  it('understands character classes, comments, escapes and Windows line endings', () => {
    expect(ignored('draft[0-9].md', 'draft7.md')).toBe(true);
    expect(ignored('draft[!0-9].md', 'draft7.md')).toBe(false);
    expect(ignored('# comment\r\n\r\nold.md\r\n', 'old.md')).toBe(true);
    expect(ignored('\\#hash.md', '#hash.md')).toBe(true);
    expect(ignored('\\!bang.md', '!bang.md')).toBe(true);
  });

  it('matches without ASCII case, as Git does on Windows', () => {
    expect(ignored('*.LOG', 'a/b.log')).toBe(true);
  });

  it('only applies rules below the folder of their .gitignore', () => {
    expect(ignored('*.csv', 'sub/data.csv', 'file', 'sub')).toBe(true);
    expect(ignored('*.csv', 'data.csv', 'file', 'sub')).toBe(false);
    expect(ignored('/x.md', 'sub/x.md', 'file', 'sub')).toBe(true);
    expect(ignored('/x.md', 'sub/deeper/x.md', 'file', 'sub')).toBe(false);
  });

  it('skips lines it does not understand instead of guessing', () => {
    const parsed = parseGitignore('[[:alpha:]].md\nfoo**bar\n[unclosed\nok.md', '');
    expect(parsed.skippedLines).toBe(3);
    expect(parsed.rules).toHaveLength(1);
  });

  it('bounds how many rules one file can add', () => {
    const parsed = parseGitignore(
      Array.from({ length: 1_500 }, (_, i) => `f${String(i)}`).join('\n'),
      '',
    );
    expect(parsed.rules).toHaveLength(1_000);
    expect(parsed.skippedLines).toBe(500);
  });
});

describe('exclusionFor', () => {
  it('keeps built-in exclusions even when a .gitignore re-includes them', () => {
    const rules = parseGitignore('!.env\n!node_modules/', '').rules;
    expect(exclusionFor('.env', '.env', 'file', rules)).toBe('environment_file');
    expect(exclusionFor('node_modules', 'node_modules', 'folder', rules)).toBe('dependencies');
  });

  it('reports gitignore before hidden, and hidden last', () => {
    const rules = parseGitignore('drafts/old.md', '').rules;
    expect(exclusionFor('drafts/old.md', 'old.md', 'file', rules)).toBe('gitignore');
    expect(exclusionFor('.github', '.github', 'folder', rules)).toBe('hidden');
    expect(exclusionFor('brief.md', 'brief.md', 'file', rules)).toBeUndefined();
  });
});
