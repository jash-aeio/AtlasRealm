import { describe, expect, it } from 'vitest';

import { WorkerCheckInput, WorkerStatusInput } from '../../src/common/contracts/runtime-worker';

// The renderer controls these payloads, so the schemas are the first line of defence.

describe('runtime.workerStatus input', () => {
  it('takes no payload at all', () => {
    expect(WorkerStatusInput.safeParse(undefined).success).toBe(true);
    expect(WorkerStatusInput.safeParse({}).success).toBe(false);
    expect(WorkerStatusInput.safeParse(null).success).toBe(false);
  });
});

describe('runtime.workerCheck input', () => {
  it('accepts no payload or a bounded cancelAfterMs', () => {
    expect(WorkerCheckInput.safeParse(undefined).success).toBe(true);
    expect(WorkerCheckInput.safeParse({ cancelAfterMs: 10 }).success).toBe(true);
    expect(WorkerCheckInput.safeParse({ cancelAfterMs: 5_000 }).success).toBe(true);
  });

  it.each([
    ['an empty object', {}],
    ['null', null],
    ['too short', { cancelAfterMs: 9 }],
    ['too long (would tie up the check)', { cancelAfterMs: 5_001 }],
    ['a fraction', { cancelAfterMs: 10.5 }],
    ['a string', { cancelAfterMs: '100' }],
    ['unknown keys', { cancelAfterMs: 100, method: 'fs.readFile' }],
  ])('rejects %s', (_label, payload) => {
    expect(WorkerCheckInput.safeParse(payload).success).toBe(false);
  });
});
