// The keyboard and screen-reader equivalent of the Connections graph (M2-13 #78, GRAPH_MODEL
// §30.6, UI_SPEC §6.6): every link as source, relation, target and origin, and every project the
// graph shows, placed or not. Everything the canvas offers is here as an ordinary button: select
// a project (which never starts work) or remove a link (which asks first).
import type { GraphProjectNode } from '../../common/contracts/graph';
import type { RelationSummary } from '../../common/contracts/relation';
import { nodeDescription, ORIGIN_LABELS, RELATION_LABELS } from './connections-layout';

interface ConnectionsListProps {
  readonly nodes: readonly GraphProjectNode[];
  readonly edges: readonly RelationSummary[];
  readonly selectedProjectId: string | null;
  readonly onSelect: (projectId: string) => void;
  /** Opens the removal confirmation for a link; null while link changes are not allowed. */
  readonly onRemove: ((relation: RelationSummary) => void) | null;
}

export function ConnectionsList({
  nodes,
  edges,
  selectedProjectId,
  onSelect,
  onRemove,
}: ConnectionsListProps) {
  const byId = new Map(nodes.map((n) => [n.projectId, n]));
  const nameOf = (id: string) => byId.get(id)?.name ?? 'Unknown project';

  function projectButton(id: string) {
    return (
      <button
        type="button"
        aria-pressed={id === selectedProjectId}
        onClick={() => {
          onSelect(id);
        }}
      >
        {nameOf(id)}
      </button>
    );
  }

  return (
    <div className="atlas-connections-list">
      <details className="atlas-list" data-testid="atlas-links-list" open>
        <summary>Links list ({edges.length})</summary>
        {edges.length === 0 ? (
          <p className="muted">No links yet. Use "Add a link" to describe how projects relate.</p>
        ) : (
          <table className="atlas-links-table">
            <caption className="visually-hidden">
              Links between projects: source, relation, target and who made each link
            </caption>
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col">Relation</th>
                <th scope="col">Target</th>
                <th scope="col">Origin</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {edges.map((edge) => (
                <tr key={edge.id} data-relation-id={edge.id}>
                  <td>{projectButton(edge.sourceProjectId)}</td>
                  <td>
                    {RELATION_LABELS[edge.type]} <span aria-hidden="true">→</span>
                  </td>
                  <td>{projectButton(edge.targetProjectId)}</td>
                  <td>{ORIGIN_LABELS[edge.origin]}</td>
                  <td>
                    {onRemove !== null && (
                      <button
                        type="button"
                        aria-label={`Remove link: ${nameOf(edge.sourceProjectId)} ${RELATION_LABELS[edge.type]} ${nameOf(edge.targetProjectId)}`}
                        onClick={() => {
                          onRemove(edge);
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </details>

      <details className="atlas-list" data-testid="atlas-nodes-list">
        <summary>Projects list ({nodes.length})</summary>
        <ul>
          {nodes.map((n) => (
            <li key={n.projectId}>
              <button
                type="button"
                aria-pressed={n.projectId === selectedProjectId}
                onClick={() => {
                  onSelect(n.projectId);
                }}
              >
                {nodeDescription(n)}
              </button>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
