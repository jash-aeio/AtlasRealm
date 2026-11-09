import { useSyncExternalStore } from 'react';

import type { Store } from './store';

/**
 * Reads a store in a React component and re-renders it when the value changes.
 * useSyncExternalStore is React's built-in way to read outside state without tearing
 * (two components showing different values during one render).
 */
export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get);
}
