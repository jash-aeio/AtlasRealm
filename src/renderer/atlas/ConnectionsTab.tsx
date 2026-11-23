// The Realm Atlas Connections tab in the world context (M2-13 #78, GRAPH_MODEL §30.1, §30.3–30.6):
// "How is this related?" It shows every project of the world, placed or not, and the links
// between them, read from `graph.worldConnections`, with what was left out stated as counts.
//
// The tab holds only display state: the session's dragged node positions (ADR-0032), the last
// result message and which link is being removed. Projects and links are read again from the
// main process after each committed change, so nothing here can drift from what is saved.
import { useCallback, useRef, useState } from 'react';

import type { RelationSummary, RelationType } from '../../common/contracts/relation';
import { RELATION_TYPES } from '../../common/contracts/relation';
import type { WorldSummary } from '../../common/contracts/world';
import { ConnectionsGraph } from './ConnectionsGraph';
import { ConnectionsList } from './ConnectionsList';
import { RELATION_LABELS, RELATION_LINE_STYLES, type Point } from './connections-layout';
import { LinkForm, relationProblem, RemoveLinkDialog } from './LinkForm';
import { useWorldConnections } from './use-world-connections';

interface ConnectionsTabProps {
  readonly world: WorldSummary;
  readonly selectedProjectId: string | null;
  readonly onSelect: (projectId: string) => void;
  /** Bumped by the parent after any project change (rename, archive, trash…). */
  readonly version: number;
  readonly reducedMotion: boolean;
}

export function ConnectionsTab({
  world,
  selectedProjectId,
  onSelect,
  version,
  reducedMotion,
}: ConnectionsTabProps) {
  const { load, reload } = useWorldConnections(world.id, version);
  const [moved, setMoved] = useState<ReadonlyMap<string, Point>>(new Map());
  const [layoutResets, setLayoutResets] = useState(0);
  const [result, setResult] = useState<{ message: string; ok: boolean } | null>(null);
  const [removing, setRemoving] = useState<RelationSummary | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const onMove = useCallback((projectId: string, position: Point) => {
    setMoved((current) => new Map(current).set(projectId, position));
  }, []);

  const onResult = useCallback(
    (message: string, ok: boolean) => {
      setResult({ message, ok });
      // A failure may mean the data changed elsewhere, so read again either way.
      reload();
    },
    [reload],
  );

  if (load.status === 'loading') {
    return (
      <div data-testid="atlas-connections">
        <p className="muted">Reading projects and links…</p>
      </div>
    );
  }
  if (load.status === 'error') {
    return (
      <div data-testid="atlas-connections">
        <p role="alert" className="error">
          Could not read this world&apos;s links: {relationProblem(load.error)} ({load.error.code})
        </p>
        <button type="button" onClick={reload}>
          Try again
        </button>
      </div>
    );
  }

  const { nodes, edges, totalNodes, totalEdges, omittedNodes, omittedEdges } = load.data;
  const editable = world.archivedAt === null;
  const nameOf = (id: string) =>
    nodes.find((n) => n.projectId === id)?.name ?? 'a project not in the graph';

  return (
    <div className="atlas-connections" data-testid="atlas-connections">
      <p className="muted" data-testid="atlas-connections-counts">
        {totalNodes} {totalNodes === 1 ? 'project' : 'projects'} · {totalEdges}{' '}
        {totalEdges === 1 ? 'link' : 'links'}
        {omittedNodes + omittedEdges > 0 && (
          <span data-testid="atlas-connections-truncated">
            {' '}
            · showing {nodes.length} {nodes.length === 1 ? 'project' : 'projects'} and{' '}
            {edges.length} {edges.length === 1 ? 'link' : 'links'}:{' '}
            {plural(omittedNodes, 'project')} and {plural(omittedEdges, 'link')} left out
          </span>
        )}
      </p>

      {nodes.length === 0 ? (
        <p className="muted">
          No projects in this world yet. Create one in the Projects list to see it here.
        </p>
      ) : (
        <ConnectionsGraph
          nodes={nodes}
          edges={edges}
          selectedProjectId={selectedProjectId}
          onSelect={onSelect}
          moved={moved}
          onMove={onMove}
          layoutResets={layoutResets}
          reducedMotion={reducedMotion}
        />
      )}

      <Legend />

      <div className="atlas-map-actions">
        <button
          type="button"
          data-testid="atlas-reset-layout"
          disabled={nodes.length === 0}
          onClick={() => {
            setMoved(new Map());
            setLayoutResets((n) => n + 1);
          }}
        >
          Reset layout
        </button>
        <span className="muted">
          Dragging projects here only rearranges this picture; buildings stay where they are.
        </span>
      </div>

      <p
        role={result?.ok === false ? 'alert' : 'status'}
        className={result?.ok === false ? 'error' : 'muted'}
        data-testid="atlas-link-result"
      >
        {result?.message ?? ''}
      </p>

      {editable ? (
        <LinkForm
          worldId={world.id}
          nodes={nodes}
          omittedNodes={omittedNodes}
          selectedProjectId={selectedProjectId}
          onResult={onResult}
        />
      ) : (
        <p className="muted">This world is archived, so its links can be read but not changed.</p>
      )}

      <div ref={listRef} tabIndex={-1}>
        <ConnectionsList
          nodes={nodes}
          edges={edges}
          selectedProjectId={selectedProjectId}
          onSelect={onSelect}
          onRemove={editable ? setRemoving : null}
        />
      </div>

      {removing !== null && (
        <RemoveLinkDialog
          worldId={world.id}
          relation={removing}
          sourceName={nameOf(removing.sourceProjectId)}
          targetName={nameOf(removing.targetProjectId)}
          onResult={onResult}
          onClose={() => {
            setRemoving(null);
          }}
          fallbackFocus={() => listRef.current?.focus()}
        />
      )}
    </div>
  );
}

const plural = (count: number, noun: string) => `${String(count)} ${noun}${count === 1 ? '' : 's'}`;

/** Link types by label and line shape, and what node shapes mean (§30.4, §30.6). */
function Legend() {
  return (
    <div className="atlas-legend" data-testid="atlas-connections-legend">
      <p className="muted">Arrows point from the source project to the target project.</p>
      <ul>
        {RELATION_TYPES.map((type: RelationType) => (
          <li key={type}>
            <svg className="atlas-legend-line" width="36" height="10" aria-hidden="true">
              <line className={`atlas-legend-${type}`} x1="2" y1="5" x2="28" y2="5" />
              <polygon points="28,1 35,5 28,9" />
            </svg>{' '}
            {RELATION_LABELS[type]} ({RELATION_LINE_STYLES[type]})
          </li>
        ))}
        <li>Dashed border: archived project</li>
        <li>Rounded, &quot;no building&quot;: project not on the map (inner ring)</li>
      </ul>
    </div>
  );
}
