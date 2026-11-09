// A minimal external store: one value, a way to change it, and change notifications.
//
// "External" means the value lives outside any React component. React components read it
// through `useStore` (built on React's useSyncExternalStore), and plain code such as the
// Pixi scene can call `subscribe` directly. Every view therefore reads the same value,
// and none of them owns it (ADR-0003: no separate authoritative models per view).
//
// Pure TypeScript with no React or DOM imports, so it's unit-tested in plain Node.

// Function properties rather than methods: they never use `this`, so callers may pass them
// around on their own (useSyncExternalStore(store.subscribe, store.get) does exactly that).
export interface Store<T> {
  /** The current value. Returns the same object until `set` stores a different one. */
  readonly get: () => T;
  /** Replaces the value and notifies subscribers, unless `equals` says nothing changed. */
  readonly set: (next: T) => void;
  /** Calls `listener` after every change. Returns a function that unsubscribes it. */
  readonly subscribe: (listener: () => void) => () => void;
}

export function createStore<T>(initial: T, equals: (a: T, b: T) => boolean = Object.is): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      if (equals(value, next)) return;
      value = next;
      // Copy first: a listener may unsubscribe (or subscribe another) while we loop.
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
