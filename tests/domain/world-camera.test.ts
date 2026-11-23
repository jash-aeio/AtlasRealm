// The world view ↔ Realm Atlas camera bridge (M2-12 #77): viewport math and the centring
// request, which only does something while a world view is listening.
import { describe, expect, it, vi } from 'vitest';

import { worldToScreen } from '../../src/renderer/world/projection';
import {
  cameraCentredOn,
  createWorldCamera,
  viewportWorldRect,
} from '../../src/renderer/world/world-camera';

describe('viewportWorldRect', () => {
  it('maps the canvas corners back into world pixels', () => {
    const viewport = { camera: { panX: 100, panY: -50, zoom: 2 }, width: 800, height: 600 };
    expect(viewportWorldRect(viewport)).toEqual({ left: -50, top: 25, right: 350, bottom: 325 });
  });
});

describe('cameraCentredOn', () => {
  it('puts the point in the middle of the canvas at the given zoom', () => {
    const camera = cameraCentredOn({ x: 640, y: 320 }, 1.5, 800, 600);
    expect(camera.zoom).toBe(1.5);
    expect(worldToScreen({ x: 640, y: 320 }, camera)).toEqual({ x: 400, y: 300 });
  });

  it('clamps the zoom to the allowed bounds', () => {
    expect(cameraCentredOn({ x: 0, y: 0 }, 99, 100, 100).zoom).toBe(4);
  });
});

describe('createWorldCamera', () => {
  it('says when no world view is listening, and forwards requests when one is', () => {
    const bridge = createWorldCamera();
    expect(bridge.centerOn({ x: 1, y: 2 })).toBe(false);
    const centre = vi.fn();
    const detach = bridge.attach(centre);
    expect(bridge.centerOn({ x: 1, y: 2 })).toBe(true);
    expect(centre).toHaveBeenCalledWith({ x: 1, y: 2 });
    detach();
    expect(bridge.centerOn({ x: 3, y: 4 })).toBe(false);
    expect(centre).toHaveBeenCalledTimes(1);
  });

  it('a stale detach does not remove a newer world view', () => {
    const bridge = createWorldCamera();
    const first = bridge.attach(vi.fn());
    const second = vi.fn();
    bridge.attach(second);
    first();
    expect(bridge.centerOn({ x: 0, y: 0 })).toBe(true);
    expect(second).toHaveBeenCalled();
  });

  it('notifies only when the viewport really changes', () => {
    const bridge = createWorldCamera();
    const listener = vi.fn();
    bridge.viewport.subscribe(listener);
    const viewport = { camera: { panX: 1, panY: 2, zoom: 1 }, width: 10, height: 10 };
    bridge.report(viewport);
    bridge.report({ ...viewport, camera: { ...viewport.camera } });
    expect(listener).toHaveBeenCalledTimes(1);
    bridge.report(null);
    expect(bridge.viewport.get()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
