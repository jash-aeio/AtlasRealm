// The inspector card (UI_SPEC §6.1, §6.2 "click building: select and show project summary"):
// the selected project's name, status, goal and building, read from the main process.
//
// It only shows and offers: "Open" asks the parent to show the details panel, and "Unarchive"
// (user decision 2026-11-21) runs `project.restore` after the same confirmation the project
// list uses. Clearing the selection changes nothing saved. The map actions (M2-7) open the
// placement tool or remove the building after a confirmation; the project itself is kept.
import { useRef, useState } from 'react';

import type { WorldSummary } from '../../common/contracts/world';
import { ConfirmDialog } from '../projects/ConfirmDialog';
import { LIFECYCLE_COPY, projectCommandProblem, STATUS_LABELS } from '../projects/project-messages';
import { useProject } from '../projects/use-project';
import type { ProjectSelection } from '../state/selection';
import { useStore } from '../state/use-store';
import { REMOVE_FROM_MAP_COPY, type PlacementActions } from './placement-tool';
import { placementOf, placementText, type WorldPlacements } from './world-placements';

interface ProjectInspectorProps {
  readonly world: WorldSummary;
  readonly selection: ProjectSelection;
  readonly placements: WorldPlacements;
  /** Bumped by the parent after any project change, so the summary is read again. */
  readonly version: number;
  readonly onOpen: (projectId: string) => void;
  /** Called after this card changed a project (Unarchive), so other views reload. */
  readonly onChanged: () => void;
  /** Place, move and remove the project's building (M2-7). */
  readonly placementActions?: PlacementActions;
}

export function ProjectInspector(props: ProjectInspectorProps) {
  const projectId = useStore(props.selection.projectId);
  if (projectId === null) {
    return (
      <div data-testid="inspector">
        <p>Nothing selected.</p>
        <p className="muted">Click a building in the world to see its project here.</p>
      </div>
    );
  }
  // Keyed by project: another selection starts with fresh messages and no open dialog.
  return <SelectedProject key={projectId} projectId={projectId} {...props} />;
}

function SelectedProject({
  world,
  selection,
  placements,
  version,
  onOpen,
  onChanged,
  placementActions,
  projectId,
}: ProjectInspectorProps & { readonly projectId: string }) {
  const load = useProject(world.id, projectId, version);
  const placementState = useStore(placements.store);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const card = useRef<HTMLDivElement>(null);

  if (load.status === 'loading') {
    return (
      <div data-testid="inspector">
        <p role="status">Reading the project…</p>
      </div>
    );
  }
  if (load.status === 'error') {
    return (
      <div data-testid="inspector">
        <p role="alert" className="error">
          {load.error.code === 'not_found'
            ? 'This project is no longer here.'
            : `Could not read the project: ${load.error.message} (${load.error.code})`}
        </p>
        <button type="button" onClick={selection.clear}>
          Clear selection
        </button>
      </div>
    );
  }

  const { project } = load;
  const placement = placementOf(placementState, project.id);

  async function unarchive() {
    setBusy(true);
    const result = await window.atlas.project.restore({
      worldId: world.id,
      projectId: project.id,
      expectedRevision: project.revision,
    });
    setBusy(false);
    setConfirming(false);
    setMessage(
      result.ok
        ? { ok: true, text: `Unarchived “${project.name}”. It is active again.` }
        : { ok: false, text: projectCommandProblem(result.error) },
    );
    // Reload either way: a conflict means the saved project differs from what we showed.
    onChanged();
  }

  async function removeFromMap() {
    if (placementActions === undefined) return;
    setBusy(true);
    try {
      setMessage(await placementActions.remove({ id: project.id, name: project.name }));
    } finally {
      setBusy(false);
      setRemoving(false);
    }
  }

  // A trashed project can't be placed (ADR-0025); an archived one can.
  const mapActions =
    project.status === 'trashed' || placementState.status === 'loading'
      ? undefined
      : placementActions;
  const target = { id: project.id, name: project.name };
  const restoreCopy = LIFECYCLE_COPY.restore;
  return (
    <div data-testid="inspector" data-project-id={project.id} ref={card} tabIndex={-1}>
      <h3 className="inspector-name">{project.name}</h3>
      <dl className="inspector-facts">
        <dt>Status</dt>
        <dd data-testid="inspector-status">{STATUS_LABELS[project.status]}</dd>
        <dt>Goal</dt>
        <dd>{project.goal === '' ? <span className="muted">No goal yet</span> : project.goal}</dd>
        <dt>In the world</dt>
        <dd data-testid="inspector-placement">{placementText(placement)}</dd>
      </dl>
      {message !== null && (
        <p role={message.ok ? 'status' : 'alert'} className={message.ok ? 'ok' : 'error'}>
          {message.text}
        </p>
      )}
      <div className="inspector-actions">
        <button
          type="button"
          className="primary"
          onClick={() => {
            onOpen(project.id);
          }}
        >
          Open
        </button>
        {project.status === 'archived' && (
          <button
            type="button"
            onClick={() => {
              setMessage(null);
              setConfirming(true);
            }}
          >
            Unarchive
          </button>
        )}
        {mapActions !== undefined && placement === undefined && (
          <button
            type="button"
            onClick={() => {
              mapActions.place(target);
            }}
          >
            Place on map
          </button>
        )}
        {mapActions !== undefined && placement !== undefined && (
          <>
            <button
              type="button"
              onClick={() => {
                mapActions.move(target);
              }}
            >
              Move building
            </button>
            <button
              type="button"
              onClick={() => {
                setMessage(null);
                setRemoving(true);
              }}
            >
              {REMOVE_FROM_MAP_COPY.button}
            </button>
          </>
        )}
        <button type="button" onClick={selection.clear}>
          Clear selection
        </button>
      </div>
      {removing && (
        <ConfirmDialog
          title={REMOVE_FROM_MAP_COPY.title(project.name)}
          happens={REMOVE_FROM_MAP_COPY.happens}
          doesNotHappen={REMOVE_FROM_MAP_COPY.doesNotHappen}
          confirmLabel={REMOVE_FROM_MAP_COPY.confirm}
          busy={busy}
          onConfirm={() => void removeFromMap()}
          onClose={() => {
            if (!busy) setRemoving(false);
          }}
          fallbackFocus={() => card.current?.focus()}
        />
      )}
      {confirming && (
        <ConfirmDialog
          title={`Unarchive “${project.name}”?`}
          happens={[
            ...restoreCopy.happens,
            ...(placement === undefined ? [] : ['Its building stays where it is in the world.']),
          ]}
          doesNotHappen={restoreCopy.doesNotHappen}
          confirmLabel="Unarchive project"
          busy={busy}
          onConfirm={() => void unarchive()}
          onClose={() => {
            if (!busy) setConfirming(false);
          }}
          fallbackFocus={() => card.current?.focus()}
        />
      )}
    </div>
  );
}
