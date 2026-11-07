// PreToolUse(Edit|Write|MultiEdit): blocks writing secret files or content that looks like a credential.
// Spec rule: no credentials in source, logs, backups, fixtures, or renderer state.
import { readInput, block } from './lib.mjs';

const input = await readInput();
const ti = input?.tool_input ?? {};
const filePath = String(ti.file_path ?? '').replace(/\\/g, '/');
const name = filePath.split('/').pop() ?? '';

if (/^\.env(\..+)?$/.test(name) && name !== '.env.example') {
  block(
    `Writing ${name} is not allowed. Secrets go in the OS credential vault (app) or your own local env, never via Claude. Use .env.example for placeholders.`,
  );
}
if (/\.(pem|key|p12|pfx)$/i.test(name) || /^id_(rsa|ed25519|ecdsa)/.test(name)) {
  block(`Writing key material (${name}) is not allowed.`);
}

const texts = [
  ti.content,
  ti.new_string,
  ...(Array.isArray(ti.edits) ? ti.edits.map((e) => e?.new_string) : []),
].filter((t) => typeof t === 'string');

const patterns = [
  [/sk-ant-[A-Za-z0-9_-]{20,}/, 'an Anthropic API key'],
  [/\bsk-(proj-)?[A-Za-z0-9_-]{32,}/, 'an OpenAI-style API key'],
  [/\bghp_[A-Za-z0-9]{36}\b/, 'a GitHub token'],
  [/\bgithub_pat_[A-Za-z0-9_]{50,}/, 'a GitHub fine-grained token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'an AWS access key'],
  [/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/, 'a private key'],
];

for (const text of texts) {
  for (const [re, label] of patterns) {
    if (re.test(text)) {
      block(
        `Content looks like ${label}. Never put real credentials in files. Use a placeholder such as "<YOUR_KEY>" instead.`,
      );
    }
  }
}

process.exit(0);
