// Reads one project with `project.get` for the inspector and the details panel (M2-6 #71).
//
// The selection only holds an ID, so what is shown is always the saved project, read again
// whenever the ID or `version` changes (the parent bumps `version` after any change).
import { useEffect, useState } from 'react';

import type { IpcError } from '../../common/contracts/ipc-result';
import type { ProjectSummary } from '../../common/contracts/project';

export type ProjectLoad =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly project: ProjectSummary }
  | { readonly status: 'error'; readonly error: IpcError };

export function useProject(worldId: string, projectId: string, version: number): ProjectLoad {
  const [load, setLoad] = useState<{ key: string; value: ProjectLoad } | null>(null);
  const key = `${worldId}/${projectId}/${String(version)}`;

  useEffect(() => {
    let current = true;
    void window.atlas.project.get({ worldId, projectId }).then((result) => {
      if (!current) return;
      setLoad({
        key,
        value: result.ok
          ? { status: 'ready', project: result.data.project }
          : { status: 'error', error: result.error },
      });
    });
    return () => {
      current = false;
    };
  }, [worldId, projectId, key]);

  // A stale answer (for another project) is never shown: it reads as loading instead. While
  // only `version` changed, the last answer for the same project stays up (no flicker).
  if (load?.key.startsWith(`${worldId}/${projectId}/`) === true) return load.value;
  return { status: 'loading' };
}
