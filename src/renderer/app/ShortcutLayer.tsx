// React wiring for the shortcut layer (shortcuts.ts): one layer per main screen, listening on
// the window, shared with components through context so later features (the library, the
// hotbar, undo) add their keys with `useShortcut` instead of their own listeners.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

import { createShortcutLayer, type Shortcut, type ShortcutLayer } from './shortcuts';

const ShortcutContext = createContext<ShortcutLayer | null>(null);

/** A `<dialog>` opened with `showModal()` owns the keyboard (ConfirmDialog uses one). */
function modalDialogOpen(): boolean {
  return document.querySelector('dialog:modal') !== null;
}

export function ShortcutProvider({ children }: { readonly children: ReactNode }) {
  // Created during render, so children can register in their effects, which run before ours.
  const [layer] = useState(() => createShortcutLayer(modalDialogOpen));
  useEffect(() => layer.listen(window), [layer]);
  return <ShortcutContext.Provider value={layer}>{children}</ShortcutContext.Provider>;
}

/**
 * Registers a shortcut while the component is mounted and `enabled` is true. `run` may change
 * on every render; the latest one is called.
 */
export function useShortcut(
  key: string,
  run: () => void,
  options: { readonly enabled?: boolean; readonly ctrl?: boolean; readonly shift?: boolean } = {},
): void {
  const layer = useContext(ShortcutContext);
  if (layer === null) throw new Error('useShortcut needs a ShortcutProvider');
  const latest = useRef(run);
  latest.current = run;
  const { enabled = true, ctrl, shift } = options;

  useEffect(() => {
    if (!enabled) return;
    const shortcut: Shortcut = {
      key,
      ...(ctrl === undefined ? {} : { ctrl }),
      ...(shift === undefined ? {} : { shift }),
      run: () => {
        latest.current();
      },
    };
    return layer.register(shortcut);
  }, [layer, key, enabled, ctrl, shift]);
}
