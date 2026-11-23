// Reads the world's projects and links for the Connections tab (M2-13 #78, GRAPH_MODEL §30.7).
//
// The main process is the only authoritative copy: the tab reads `graph.worldConnections` again
// whenever the world, the parent's project `version` or `reload()` asks for it, and shows that
// answer. React Flow only draws it, so the graph can never claim a link that isn't saved.
import { useCallback, useEffect, useState } from 'react';

import type { GraphWorldConnectionsOutput } from '../../common/contracts/graph';
import type { IpcError } from '../../common/contracts/ipc-result';

export type ConnectionsLoad =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly data: GraphWorldConnectionsOutput }
  | { readonly status: 'error'; readonly error: IpcError };

export interface WorldConnections {
  /** The latest answer. While a re-read is under way, the previous answer stays up. */
  readonly load: ConnectionsLoad;
  /** Reads again, for example after a link was created or removed. */
  readonly reload: () => void;
}

export function useWorldConnections(worldId: string, version: number): WorldConnections {
  const [reloads, setReloads] = useState(0);
  const [load, setLoad] = useState<{ worldId: string; value: ConnectionsLoad } | null>(null);

  useEffect(() => {
    let current = true;
    void window.atlas.graph.worldConnections({ worldId }).then((result) => {
      if (!current) return;
      setLoad({
        worldId,
        value: result.ok
          ? { status: 'ready', data: result.data }
          : { status: 'error', error: result.error },
      });
    });
    return () => {
      current = false;
    };
  }, [worldId, version, reloads]);

  const reload = useCallback(() => {
    setReloads((n) => n + 1);
  }, []);

  // Another world's answer is never shown.
  return {
    load: load?.worldId === worldId ? load.value : { status: 'loading' },
    reload,
  };
}
