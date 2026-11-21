import { describe, expect, it, vi, type Mock } from 'vitest';

import {
  createShortcutLayer,
  isEditableTarget,
  type KeyEventLike,
  type KeyEventSource,
} from '../../src/renderer/app/shortcuts';

/** A fake keydown whose preventDefault is a spy. */
type FakeKey = KeyEventLike & { readonly preventDefault: Mock<() => void> };

/** A fake keydown. The target defaults to a plain button (not editable). */
function key(value: string, overrides: Partial<KeyEventLike> = {}): FakeKey {
  return {
    key: value,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    repeat: false,
    isComposing: false,
    defaultPrevented: false,
    target: { tagName: 'BUTTON', isContentEditable: false },
    ...overrides,
    preventDefault: vi.fn<() => void>(),
  };
}

function layerWith(run = vi.fn(), modalOpen = false) {
  const layer = createShortcutLayer(() => modalOpen);
  layer.register({ key: 'e', run });
  return { layer, run };
}

describe('isEditableTarget', () => {
  it.each([
    ['INPUT', true],
    ['TEXTAREA', true],
    ['SELECT', true],
    ['input', true],
    ['BUTTON', false],
    ['DIV', false],
  ])('%s → %s', (tagName, editable) => {
    expect(isEditableTarget({ tagName, isContentEditable: false })).toBe(editable);
  });

  it('treats contenteditable elements (and their children) as editable', () => {
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isEditableTarget({ tagName: 'SPAN', isContentEditable: true })).toBe(true);
  });

  it('is false for non-elements (window, document, null)', () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(undefined)).toBe(false);
    expect(isEditableTarget({})).toBe(false);
  });
});

describe('createShortcutLayer', () => {
  it('runs a matching shortcut and claims the key', () => {
    const { layer, run } = layerWith();
    const event = key('e');
    expect(layer.handle(event)).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('matches letters in either case (Caps Lock)', () => {
    const { layer, run } = layerWith();
    layer.handle(key('E'));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it.each(['INPUT', 'TEXTAREA', 'SELECT'])('ignores keys typed into %s', (tagName) => {
    const { layer, run } = layerWith();
    const event = key('e', { target: { tagName, isContentEditable: false } });
    expect(layer.handle(event)).toBe(false);
    expect(run).not.toHaveBeenCalled();
    // The letter must still reach the text field.
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('ignores keys typed into contenteditable', () => {
    const { layer, run } = layerWith();
    layer.handle(key('e', { target: { tagName: 'DIV', isContentEditable: true } }));
    expect(run).not.toHaveBeenCalled();
  });

  it('ignores Escape typed into a text field too (the field keeps its draft)', () => {
    const layer = createShortcutLayer(() => false);
    const run = vi.fn();
    layer.register({ key: 'Escape', run });
    layer.handle(key('Escape', { target: { tagName: 'TEXTAREA', isContentEditable: false } }));
    expect(run).not.toHaveBeenCalled();
  });

  it('ignores every key while a modal dialog is open, checked on each key', () => {
    let modal = true;
    const layer = createShortcutLayer(() => modal);
    const run = vi.fn();
    layer.register({ key: 'Escape', run });
    expect(layer.handle(key('Escape'))).toBe(false);
    modal = false;
    expect(layer.handle(key('Escape'))).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('ignores repeats, IME composition and keys another handler already used', () => {
    const { layer, run } = layerWith();
    layer.handle(key('e', { repeat: true }));
    layer.handle(key('e', { isComposing: true }));
    layer.handle(key('e', { defaultPrevented: true }));
    expect(run).not.toHaveBeenCalled();
  });

  it('requires modifiers to match exactly', () => {
    const { layer, run } = layerWith();
    layer.handle(key('E', { shiftKey: true }));
    layer.handle(key('e', { ctrlKey: true }));
    layer.handle(key('e', { altKey: true }));
    layer.handle(key('e', { metaKey: true }));
    expect(run).not.toHaveBeenCalled();

    const undo = vi.fn();
    layer.register({ key: 'z', ctrl: true, run: undo });
    layer.handle(key('z'));
    expect(undo).not.toHaveBeenCalled();
    layer.handle(key('z', { ctrlKey: true }));
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('lets the newest shortcut for a key win, and falls back when it is removed', () => {
    const layer = createShortcutLayer(() => false);
    const screen = vi.fn();
    const tool = vi.fn();
    layer.register({ key: 'Escape', run: screen });
    const removeTool = layer.register({ key: 'Escape', run: tool });
    layer.handle(key('Escape'));
    expect(tool).toHaveBeenCalledTimes(1);
    expect(screen).not.toHaveBeenCalled();
    removeTool();
    layer.handle(key('Escape'));
    expect(screen).toHaveBeenCalledTimes(1);
  });

  it('does nothing (and leaves the key alone) when no shortcut matches', () => {
    const { layer, run } = layerWith();
    const event = key('q');
    expect(layer.handle(event)).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('listens with exactly one keydown listener and removes it again', () => {
    const listeners = new Set<(event: KeyEventLike) => void>();
    const add = vi.fn((_: 'keydown', listener: (event: KeyEventLike) => void) => {
      listeners.add(listener);
    });
    const source: KeyEventSource = {
      addEventListener: add,
      removeEventListener: (_, listener) => {
        listeners.delete(listener);
      },
    };
    const { layer, run } = layerWith();
    const stop = layer.listen(source);
    expect(add).toHaveBeenCalledTimes(1);
    expect(add.mock.calls[0]?.[0]).toBe('keydown');
    expect(() => layer.listen(source)).toThrow(/already listening/);

    for (const listener of listeners) listener(key('e'));
    expect(run).toHaveBeenCalledTimes(1);

    stop();
    expect(listeners.size).toBe(0);
    // A stopped layer can listen again (React StrictMode mounts effects twice).
    layer.listen(source)();
  });
});
