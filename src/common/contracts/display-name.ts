// The display-name rule shared by IPC contracts (profiles, worlds, later projects).
// It mirrors normalizeName in src/main/storage/repositories/repository-support.ts, which runs
// again in the main process; checking here as well means a bad name fails at the boundary
// with `invalid_payload` before any service code runs.
import { z } from 'zod';

import { hasHiddenCharacters } from '../text/hidden-characters';

export const DISPLAY_NAME_MAX_CHARS = 80;

// Control characters and line/paragraph separators. Hidden characters (spoofing characters,
// variation selector runs, invisible fillers) are checked by hasHiddenCharacters.
const FORBIDDEN = /[\p{Cc}\p{Zl}\p{Zp}]/u;
const LONE_SURROGATE = /[\uD800-\uDFFF]/u;

/** Trimmed, 1–80 characters (code points, as SQLite counts them), one clean line. */
export const DisplayName = z
  .string()
  // Cheap bound before trimming and scanning: 80 code points are at most 160 UTF-16 units.
  // `abort` skips the scans below for oversized input (#111 security review L2).
  .max(DISPLAY_NAME_MAX_CHARS * 2 + 64, { abort: true })
  .trim()
  .min(1)
  .refine((name) => Array.from(name).length <= DISPLAY_NAME_MAX_CHARS, 'name is too long')
  .refine(
    (name) => !FORBIDDEN.test(name) && !hasHiddenCharacters(name) && !LONE_SURROGATE.test(name),
    'invalid characters',
  );

/**
 * A name as stored, on output: a plain bounded string. Input uses DisplayName and the
 * repository checks again, so this only has to keep one row saved under older, looser rules
 * from failing a whole list (ADR-0033).
 */
export const StoredDisplayName = z.string().max(400);

/** Revision numbers start at 1 and only grow (DATA_MODEL §9.2). */
export const Revision = z.int().min(1).max(Number.MAX_SAFE_INTEGER);

/** ISO 8601 UTC timestamp as stored by the repositories. */
export const Timestamp = z.iso.datetime();
