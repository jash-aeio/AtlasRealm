// The display-name rule shared by IPC contracts (profiles, worlds, later projects).
// It mirrors normalizeName in src/main/storage/repositories/repository-support.ts, which runs
// again in the main process; checking here as well means a bad name fails at the boundary
// with `invalid_payload` before any service code runs.
import { z } from 'zod';

export const DISPLAY_NAME_MAX_CHARS = 80;

// Control characters, "Trojan Source" spoofing characters (zero-width space, bidi marks,
// embeddings, overrides, isolates), other invisible characters (soft hyphen, word joiner,
// invisible operators, BOM, tag characters), line/paragraph separators and unpaired
// surrogates. Zero-width (non-)joiners stay allowed: emoji and some scripts need them.
const FORBIDDEN =
  /[\p{Cc}\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069\u061C\u00AD\u2060-\u2064\uFEFF\u{E0000}-\u{E007F}\p{Zl}\p{Zp}]/u;
const LONE_SURROGATE = /[\uD800-\uDFFF]/u;

/** Trimmed, 1–80 characters (code points, as SQLite counts them), one clean line. */
export const DisplayName = z
  .string()
  // Cheap bound before trimming and scanning: 80 code points are at most 160 UTF-16 units.
  .max(DISPLAY_NAME_MAX_CHARS * 2 + 64)
  .trim()
  .min(1)
  .refine((name) => Array.from(name).length <= DISPLAY_NAME_MAX_CHARS, 'name is too long')
  .refine((name) => !FORBIDDEN.test(name) && !LONE_SURROGATE.test(name), 'invalid characters');

/** Revision numbers start at 1 and only grow (DATA_MODEL §9.2). */
export const Revision = z.int().min(1).max(Number.MAX_SAFE_INTEGER);

/** ISO 8601 UTC timestamp as stored by the repositories. */
export const Timestamp = z.iso.datetime();
