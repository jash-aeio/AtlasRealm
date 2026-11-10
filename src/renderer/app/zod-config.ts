// Renderer-wide Zod settings. Imported first in main.tsx, before any schema runs.
//
// Zod 4 normally probes for `new Function` to decide whether it can compile faster parsers.
// Our CSP forbids eval, and even though Zod catches the error, Chromium still reports a
// `script-src eval` violation. `jitless` skips the probe and the compiled fast path; parsing
// works the same, just without code generation. The main process keeps the default.
import { z } from 'zod';

z.config({ jitless: true });
