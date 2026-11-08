// Content Security Policy for the renderer (SECURITY.md §21.1).
// A CSP tells Chromium which sources the page may load scripts, styles, images and
// connections from. Anything not listed is blocked, so injected content can't run code
// or call out to the network.

const BASE_DIRECTIVES = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'"],
  'img-src': ["'self'", 'data:'],
  'font-src': ["'self'"],
  'connect-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'none'"],
  'frame-src': ["'none'"],
} satisfies Record<string, string[]>;

type Directives = Record<keyof typeof BASE_DIRECTIVES, string[]>;

function serialize(directives: Directives): string {
  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(' ')}`)
    .join('; ');
}

/** Policy for the built app (`electron-vite build`). No inline code, no remote origins. */
export const PRODUCTION_CSP = serialize(BASE_DIRECTIVES);

/**
 * Policy for `pnpm dev` only. Vite's dev server injects an inline React Refresh script
 * and inline <style> tags, and uses a WebSocket for hot reload, so those are allowed here.
 */
export const DEVELOPMENT_CSP = serialize({
  ...BASE_DIRECTIVES,
  'script-src': ["'self'", "'unsafe-inline'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'connect-src': ["'self'", 'ws://localhost:*'],
});

/** Placeholder in src/renderer/index.html, replaced at build/serve time. */
export const CSP_PLACEHOLDER = '%ATLAS_CSP%';
