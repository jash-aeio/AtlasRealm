// Creating and removing project links (M2-13 #78, GRAPH_MODEL §30.4–30.5, ADR-0029).
//
// A link is descriptive only: it never changes permissions, scheduling or files. The form sends
// `relation.create` and reports the saved result; the dialog sends `relation.remove` with the
// link's revision after spelling out that only the link goes and both projects stay. Neither
// keeps a copy of the link: the tab reads the graph again after each committed change.
import { useId, useState } from 'react';

import type { GraphProjectNode } from '../../common/contracts/graph';
import type { IpcError } from '../../common/contracts/ipc-result';
import {
  MAX_RELATIONS_PER_WORLD,
  RELATION_TYPES,
  type RelationSummary,
  type RelationType,
} from '../../common/contracts/relation';
import { ConfirmDialog } from '../projects/ConfirmDialog';
import { nodeLabel, RELATION_LABELS } from './connections-layout';

/** A message for a failed link command. */
export function relationProblem(error: IpcError): string {
  switch (error.code) {
    case 'already_exists':
      return 'Those projects already have that link.';
    case 'limit_reached':
      return `This world already has ${String(MAX_RELATIONS_PER_WORLD)} links, the most it can hold. Remove one first.`;
    case 'revision_conflict':
      return 'This link changed somewhere else. The graph was read again; check it and try again.';
    case 'not_found':
      return 'That link or project is no longer here. The graph was read again.';
    default:
      return error.message;
  }
}

interface LinkFormProps {
  readonly worldId: string;
  /** The projects the graph shows; the form can link only these. */
  readonly nodes: readonly GraphProjectNode[];
  /** Projects left out of the graph, which the form therefore can't offer. */
  readonly omittedNodes: number;
  /** Pre-fills the source with the selected project. */
  readonly selectedProjectId: string | null;
  /** Called with a one-line result after every attempt, and reloads the graph on success. */
  readonly onResult: (message: string, ok: boolean) => void;
}

export function LinkForm({
  worldId,
  nodes,
  omittedNodes,
  selectedProjectId,
  onResult,
}: LinkFormProps) {
  const baseId = useId();
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');
  const [type, setType] = useState<RelationType>('depends_on');
  const [busy, setBusy] = useState(false);

  const has = (id: string) => nodes.some((n) => n.projectId === id);
  // An empty source follows the selection, so "select, then link" needs no extra step.
  const sourceId =
    source !== '' && has(source)
      ? source
      : selectedProjectId !== null && has(selectedProjectId)
        ? selectedProjectId
        : '';
  const targetId = target !== '' && has(target) ? target : '';
  const nameOf = (id: string) => {
    const node = nodes.find((n) => n.projectId === id);
    return node === undefined ? 'a project' : node.name;
  };

  const problem =
    nodes.length < 2
      ? 'A link needs two projects in this world.'
      : sourceId === ''
        ? 'Choose the project the link starts from.'
        : targetId === ''
          ? 'Choose the project the link points to.'
          : sourceId === targetId
            ? 'A project cannot be linked to itself.'
            : null;

  async function submit() {
    if (problem !== null || busy) return;
    setBusy(true);
    const result = await window.atlas.relation.create({
      worldId,
      sourceProjectId: sourceId,
      targetProjectId: targetId,
      type,
    });
    setBusy(false);
    if (result.ok) {
      setTarget('');
      onResult(`Linked: ${nameOf(sourceId)} ${RELATION_LABELS[type]} ${nameOf(targetId)}.`, true);
    } else {
      onResult(`Could not link: ${relationProblem(result.error)}`, false);
    }
  }

  return (
    <form
      className="atlas-link-form"
      data-testid="atlas-link-form"
      aria-labelledby={`${baseId}-title`}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h3 id={`${baseId}-title`}>Add a link</h3>
      <p className="muted">
        A link only describes how projects relate. It never shares files, starts work or grants
        permissions.
      </p>
      <label htmlFor={`${baseId}-source`}>From</label>
      <select
        id={`${baseId}-source`}
        data-testid="atlas-link-source"
        value={sourceId}
        onChange={(event) => {
          setSource(event.target.value);
        }}
      >
        <option value="">Choose a project</option>
        {nodes.map((n) => (
          <option key={n.projectId} value={n.projectId}>
            {nodeLabel(n)}
          </option>
        ))}
      </select>
      <label htmlFor={`${baseId}-type`}>Relation</label>
      <select
        id={`${baseId}-type`}
        data-testid="atlas-link-type"
        value={type}
        onChange={(event) => {
          const next = RELATION_TYPES.find((t) => t === event.target.value);
          if (next !== undefined) setType(next);
        }}
      >
        {RELATION_TYPES.map((t) => (
          <option key={t} value={t}>
            {RELATION_LABELS[t]}
          </option>
        ))}
      </select>
      <label htmlFor={`${baseId}-target`}>To</label>
      <select
        id={`${baseId}-target`}
        data-testid="atlas-link-target"
        value={targetId}
        onChange={(event) => {
          setTarget(event.target.value);
        }}
      >
        <option value="">Choose a project</option>
        {nodes
          .filter((n) => n.projectId !== sourceId)
          .map((n) => (
            <option key={n.projectId} value={n.projectId}>
              {nodeLabel(n)}
            </option>
          ))}
      </select>
      {omittedNodes > 0 && (
        <p className="muted">
          {omittedNodes} more {omittedNodes === 1 ? 'project is' : 'projects are'} not in the graph
          and can&apos;t be picked here yet.
        </p>
      )}
      <div className="form-actions">
        <button
          type="submit"
          className="primary"
          data-testid="atlas-link-create"
          disabled={problem !== null || busy}
          title={problem ?? undefined}
        >
          {busy ? 'Linking…' : 'Add link'}
        </button>
      </div>
      {problem !== null && nodes.length > 0 && <p className="muted">{problem}</p>}
    </form>
  );
}

interface RemoveLinkDialogProps {
  readonly worldId: string;
  readonly relation: RelationSummary;
  readonly sourceName: string;
  readonly targetName: string;
  readonly onResult: (message: string, ok: boolean) => void;
  readonly onClose: () => void;
  readonly fallbackFocus: () => void;
}

/** Confirms, then removes one link. Both projects, their buildings and pins stay (§30.5). */
export function RemoveLinkDialog({
  worldId,
  relation,
  sourceName,
  targetName,
  onResult,
  onClose,
  fallbackFocus,
}: RemoveLinkDialogProps) {
  const [busy, setBusy] = useState(false);
  const described = `${sourceName} ${RELATION_LABELS[relation.type]} ${targetName}`;

  async function confirm() {
    setBusy(true);
    const result = await window.atlas.relation.remove({
      worldId,
      relationId: relation.id,
      expectedRevision: relation.revision,
    });
    setBusy(false);
    onResult(
      result.ok
        ? `Removed the link: ${described}. Both projects are unchanged.`
        : `Could not remove the link: ${relationProblem(result.error)}`,
      result.ok,
    );
    onClose();
  }

  return (
    <ConfirmDialog
      title="Remove this link?"
      happens={[`The link "${described}" is removed.`]}
      doesNotHappen={[
        `${sourceName} and ${targetName} are not changed, archived or deleted.`,
        'Their buildings, hotbar pins, files and other links stay as they are.',
      ]}
      confirmLabel="Remove link"
      busy={busy}
      onConfirm={() => void confirm()}
      onClose={onClose}
      fallbackFocus={fallbackFocus}
    />
  );
}
