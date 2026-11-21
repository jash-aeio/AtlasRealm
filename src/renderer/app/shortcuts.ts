// The one keyboard shortcut layer for the main screen (M2-5 #70, UI_SPEC §6.2).
//
// Every application shortcut goes through a single `keydown` listener on the window. It is an
// ordinary page listener, so it only sees keys while Atlas Realm has focus: there are no
// global OS hooks and no keys are taken from other applications.
//
// A key is left alone when the user is typing (input, textarea, select, contenteditable),
// while a modal dialog is open (the dialog owns the keyboard then), during IME composition,
// on key repeat, and when another handler already used it.
//
// The types here are structural on purpose: no DOM types, so the logic is unit-tested in
// plain Node with small fake events (tests/domain/shortcuts.test.ts).

/** The parts of a `KeyboardEvent` the layer reads. A real `KeyboardEvent` fits. */
export interface KeyEventLike {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
  readonly repeat: boolean;
  readonly isComposing: boolean;
  readonly defaultPrevented: boolean;
  readonly target: unknown;
  readonly preventDefault: () => void;
}

/** Something to listen on for `keydown`. In the app this is `window`. */
export interface KeyEventSource {
  addEventListener(type: 'keydown', listener: (event: KeyEventLike) => void): void;
  removeEventListener(type: 'keydown', listener: (event: KeyEventLike) => void): void;
}

export interface Shortcut {
  /** `KeyboardEvent.key`, e.g. `'e'`, `'1'`, `'Escape'`. Letters match either case. */
  readonly key: string;
  /** Modifiers must match exactly: `E` does not fire on Shift+E or Ctrl+E. */
  readonly ctrl?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
  readonly run: () => void;
}

export interface ShortcutLayer {
  /** Adds a shortcut and returns a function that removes it. Later shortcuts win. */
  register(shortcut: Shortcut): () => void;
  /** Runs the matching shortcut, if the event may be used. Returns whether one ran. */
  handle(event: KeyEventLike): boolean;
  /** Starts listening on `source` (once per layer) and returns a function that stops. */
  listen(source: KeyEventSource): () => void;
}

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** True for text-entry targets, where keys belong to the control, not to shortcuts. */
export function isEditableTarget(target: unknown): boolean {
  if (typeof target !== 'object' || target === null) return false;
  const element = target as { tagName?: unknown; isContentEditable?: unknown };
  // isContentEditable is also true inside a contenteditable ancestor.
  if (element.isContentEditable === true) return true;
  return typeof element.tagName === 'string' && EDITABLE_TAGS.has(element.tagName.toUpperCase());
}

/** Whether the layer may use this event at all, before looking for a matching shortcut. */
export function shouldHandle(event: KeyEventLike, modalOpen: boolean): boolean {
  if (event.defaultPrevented || event.isComposing || event.repeat) return false;
  // Meta (the Windows key) belongs to the OS.
  if (event.metaKey) return false;
  if (modalOpen) return false;
  return !isEditableTarget(event.target);
}

export function matches(shortcut: Shortcut, event: KeyEventLike): boolean {
  return (
    event.key.toLowerCase() === shortcut.key.toLowerCase() &&
    event.ctrlKey === (shortcut.ctrl ?? false) &&
    event.shiftKey === (shortcut.shift ?? false) &&
    event.altKey === (shortcut.alt ?? false)
  );
}

/**
 * Creates the layer. `isModalOpen` is asked on every key, so it always reflects the page
 * (in the app: whether a `<dialog>` opened with `showModal()` is on screen).
 */
export function createShortcutLayer(isModalOpen: () => boolean): ShortcutLayer {
  // Newest last; handle() walks backwards so a newer shortcut (an open tool) beats an older
  // one (the screen) for the same key, e.g. Escape.
  const shortcuts: Shortcut[] = [];
  let listening = false;

  const layer: ShortcutLayer = {
    register(shortcut) {
      shortcuts.push(shortcut);
      return () => {
        const index = shortcuts.lastIndexOf(shortcut);
        if (index !== -1) shortcuts.splice(index, 1);
      };
    },
    handle(event) {
      if (!shouldHandle(event, isModalOpen())) return false;
      for (let i = shortcuts.length - 1; i >= 0; i -= 1) {
        const shortcut = shortcuts[i];
        if (shortcut !== undefined && matches(shortcut, event)) {
          event.preventDefault();
          shortcut.run();
          return true;
        }
      }
      return false;
    },
    listen(source) {
      if (listening) throw new Error('This shortcut layer is already listening');
      listening = true;
      const listener = (event: KeyEventLike) => {
        layer.handle(event);
      };
      source.addEventListener('keydown', listener);
      return () => {
        source.removeEventListener('keydown', listener);
        listening = false;
      };
    },
  };
  return layer;
}
