// The switch gate (M1-8 #35, ADR-0014): while a profile switch is under way, commands are
// refused with `profile_switching` instead of running against a half-swapped profile.
import { describe, expect, it } from 'vitest';

import { APP_ENTRY_URL } from '../../src/main/bootstrap/app-origin';
import { appPingCommand, handleAppPing } from '../../src/main/ipc/commands/app-ping';
import { createCommandHandler, trustRendererEntry } from '../../src/main/ipc/router';
import {
  ActiveProfile,
  type ActiveProfileState,
  refuseWhileSwitching,
} from '../../src/main/profiles/active-profile';
import { openDatabase } from '../../src/main/storage/database';
import { toProfileId } from '../../src/main/storage/profiles/profile-id';

const trusted = { senderFrame: { url: APP_ENTRY_URL, parent: null } };

function memoryState(): ActiveProfileState {
  return { profileId: toProfileId('default'), db: openDatabase(':memory:') };
}

describe('ActiveProfile switch gate', () => {
  it('current() refuses with profile_switching during a switch and works again after', () => {
    const active = new ActiveProfile('unused', memoryState());
    expect(active.beginSwitch()).toBe(true);
    expect(() => active.current()).toThrow(expect.objectContaining({ code: 'profile_switching' }));
    active.endSwitch();
    expect(active.current().profileId).toBe('default');
  });

  it('only one switch can run at a time', () => {
    const active = new ActiveProfile('unused', memoryState());
    expect(active.beginSwitch()).toBe(true);
    expect(active.beginSwitch()).toBe(false);
  });

  it('replace() and stateDuringSwitch() only work during a switch', () => {
    const active = new ActiveProfile('unused', memoryState());
    const next = memoryState();
    expect(() => {
      active.replace(next);
    }).toThrow('No profile switch');
    expect(() => active.stateDuringSwitch()).toThrow('No profile switch');
    active.beginSwitch();
    active.replace(next);
    expect(active.stateDuringSwitch()).toBe(next);
    active.endSwitch();
    expect(active.current()).toBe(next);
  });

  it('databaseForShutdown() answers even during a switch', () => {
    const state = memoryState();
    const active = new ActiveProfile('unused', state);
    active.beginSwitch();
    expect(active.databaseForShutdown()).toBe(state.db);
  });

  it('exclusive() runs profile changes one at a time, and a failure does not block the next', async () => {
    const active = new ActiveProfile('unused', memoryState());
    const order: string[] = [];
    let release: () => void = () => undefined;
    const first = active.exclusive(
      () =>
        new Promise<void>((resolve) => {
          order.push('first:start');
          release = () => {
            order.push('first:end');
            resolve();
          };
        }),
    );
    const failing = active.exclusive(() => {
      order.push('second');
      return Promise.reject(new Error('boom'));
    });
    const third = active.exclusive(() => {
      order.push('third');
      return Promise.resolve();
    });
    await Promise.resolve();
    expect(order).toEqual(['first:start']);
    release();
    await first;
    await expect(failing).rejects.toThrow('boom');
    await third;
    expect(order).toEqual(['first:start', 'first:end', 'second', 'third']);
  });
});

describe('refuseWhileSwitching (wraps every IPC command)', () => {
  it('refuses even a command that never touches the profile, through the real router', async () => {
    const active = new ActiveProfile('unused', memoryState());
    const ping = createCommandHandler(
      appPingCommand,
      refuseWhileSwitching(active, handleAppPing),
      trustRendererEntry(APP_ENTRY_URL),
    );
    expect(await ping(trusted, { message: 'hi' })).toMatchObject({ ok: true });
    active.beginSwitch();
    expect(await ping(trusted, { message: 'hi' })).toEqual({
      ok: false,
      error: {
        code: 'profile_switching',
        message: 'The app is switching profiles. Try again once it has reloaded.',
      },
    });
    active.endSwitch();
    expect(await ping(trusted, { message: 'hi' })).toMatchObject({ ok: true });
  });
});
