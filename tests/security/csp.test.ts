import { describe, expect, it } from 'vitest';

import { DEVELOPMENT_CSP, PRODUCTION_CSP } from '../../src/common/security/csp';

function directive(csp: string, name: string): string | undefined {
  return csp
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `));
}

describe('renderer Content Security Policy', () => {
  it('production allows no inline scripts, eval or remote origins', () => {
    expect(directive(PRODUCTION_CSP, 'script-src')).toBe("script-src 'self'");
    expect(PRODUCTION_CSP).not.toMatch(/unsafe-inline|unsafe-eval|https?:|ws:|\*/);
  });

  it('blocks plugins, <base> hijacking, form posts and frames', () => {
    for (const csp of [PRODUCTION_CSP, DEVELOPMENT_CSP]) {
      expect(directive(csp, 'object-src')).toBe("object-src 'none'");
      expect(directive(csp, 'base-uri')).toBe("base-uri 'none'");
      expect(directive(csp, 'form-action')).toBe("form-action 'none'");
      expect(directive(csp, 'frame-src')).toBe("frame-src 'none'");
    }
  });

  it('development never allows eval and only connects to localhost', () => {
    expect(DEVELOPMENT_CSP).not.toContain('unsafe-eval');
    expect(directive(DEVELOPMENT_CSP, 'connect-src')).toBe("connect-src 'self' ws://localhost:*");
  });
});
