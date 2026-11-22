// One project in the list: its name, status, template and goal as text, plus the M1 actions
// for its status. Renaming and editing the goal open small forms in place. Archive, restore and
// trash first show a confirmation of what happens and what does not.
//
// The map actions (M2-7 #72) are the list equivalent of the placement tool (UI_SPEC §6.6):
// "Place on map" opens the tool, "Auto-place" places without the map, and "Remove from map"
// confirms that the project, its files and its runs are kept (§22.2 #3).
import { useId, useRef, useState } from 'react';

import type { ProjectSummary } from '../../common/contracts/project';
import { nameProblem } from '../onboarding/form-messages';
import { REMOVE_FROM_MAP_COPY, type PlacementActions } from '../world/placement-tool';
import { ConfirmDialog } from './ConfirmDialog';
import type {
  LifecycleAction,
  ProjectCommandOutcome,
  ProjectList,
  TemplatesState,
} from './project-list';
import {
  ACTIONS_FOR_STATUS,
  goalProblem,
  LIFECYCLE_COPY,
  projectCommandProblem,
  RUN_CHECK_STUB_NOTE,
  STATUS_LABELS,
} from './project-messages';

/** The result of an action, reported to the panel so it outlives this row. */
export interface ActionMessage {
  readonly ok: boolean;
  readonly text: string;
}

interface ProjectItemProps {
  readonly project: ProjectSummary;
  readonly templates: TemplatesState;
  readonly list: ProjectList;
  readonly onMessage: (message: ActionMessage) => void;
  /** Where focus goes when this row disappears (for example after archiving). */
  readonly fallbackFocus: () => void;
  /** Whether a building represents it in the world; undefined while that is unknown. */
  readonly placed?: boolean;
  /** Place, auto-place and remove its building. Without it the row shows no map actions. */
  readonly placementActions?: PlacementActions;
}

/** The template's name when it is still available, else its stored ID and version. */
export function templateLabel(project: ProjectSummary, templates: TemplatesState): string {
  if (templates.status === 'ready') {
    const match = templates.templates.find(
      (t) =>
        t.status === 'available' &&
        t.id === project.templateId &&
        t.version === project.templateVersion,
    );
    if (match?.status === 'available') return match.name;
  }
  return `${project.templateId} ${project.templateVersion}`;
}

type Editing = 'name' | 'goal' | null;

export function ProjectItem({
  project,
  templates,
  list,
  onMessage,
  fallbackFocus,
  placed,
  placementActions,
}: ProjectItemProps) {
  const headingId = `project-${project.id}`;
  const renameButton = useRef<HTMLButtonElement>(null);
  const goalButton = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [pending, setPending] = useState<LifecycleAction | null>(null);
  const [busy, setBusy] = useState(false);
  const editable = project.status !== 'trashed';
  const [removing, setRemoving] = useState(false);
  // A trashed project can't be placed (ADR-0025) and has no building; archived ones can be.
  const mapActions = editable && placed !== undefined ? placementActions : undefined;
  const target = { id: project.id, name: project.name };

  async function autoPlace() {
    if (mapActions === undefined) return;
    setBusy(true);
    try {
      onMessage(await mapActions.autoPlace(target));
    } finally {
      setBusy(false);
    }
  }

  async function removeFromMap() {
    if (mapActions === undefined) return;
    setBusy(true);
    try {
      onMessage(await mapActions.remove(target));
    } finally {
      setBusy(false);
      setRemoving(false);
    }
  }

  function stopEditing(which: Exclude<Editing, null>) {
    setEditing(null);
    (which === 'name' ? renameButton : goalButton).current?.focus();
  }

  async function confirm(action: LifecycleAction) {
    const copy = LIFECYCLE_COPY[action];
    setBusy(true);
    const outcome = await list.lifecycle(project.id, action);
    setBusy(false);
    setPending(null);
    if (outcome.ok) {
      const runs = outcome.runCheck === 'stub' ? ` ${RUN_CHECK_STUB_NOTE}` : '';
      onMessage({ ok: true, text: `${copy.done(project.name)}${runs}` });
    } else {
      onMessage({ ok: false, text: projectCommandProblem(outcome.error) });
    }
  }

  return (
    <li className="project-item" aria-labelledby={headingId} data-project-id={project.id}>
      <div className="project-item-header">
        <h4 id={headingId}>{project.name}</h4>
        <span className="badge" data-testid="project-status">
          {STATUS_LABELS[project.status]}
        </span>
        {placed === false && (
          // A project needs no building: it stays fully usable from this list (PRODUCT_RULES §3.1).
          <span className="tag" data-testid="project-not-placed">
            Not placed
          </span>
        )}
      </div>
      <p className="muted">Template: {templateLabel(project, templates)}</p>
      <p className="project-goal" data-testid="project-goal">
        {project.goal === '' ? <span className="muted">No goal yet.</span> : project.goal}
      </p>

      {editing === 'name' && (
        <EditForm
          kind="name"
          initial={project.name}
          projectName={project.name}
          onSave={async (value) => {
            const outcome = await list.rename(project.id, value);
            if (outcome.ok) onMessage({ ok: true, text: `Renamed to “${outcome.project.name}”.` });
            return outcome;
          }}
          onDone={() => {
            stopEditing('name');
          }}
        />
      )}
      {editing === 'goal' && (
        <EditForm
          kind="goal"
          initial={project.goal}
          projectName={project.name}
          onSave={async (value) => {
            const outcome = await list.updateGoal(project.id, value);
            if (outcome.ok) onMessage({ ok: true, text: `Saved the goal of “${project.name}”.` });
            return outcome;
          }}
          onDone={() => {
            stopEditing('goal');
          }}
        />
      )}

      <div className="project-actions" role="group" aria-label={`Actions for ${project.name}`}>
        {editable && (
          <>
            <button
              ref={renameButton}
              type="button"
              aria-expanded={editing === 'name'}
              onClick={() => {
                setEditing((e) => (e === 'name' ? null : 'name'));
              }}
            >
              Rename
            </button>
            <button
              ref={goalButton}
              type="button"
              aria-expanded={editing === 'goal'}
              onClick={() => {
                setEditing((e) => (e === 'goal' ? null : 'goal'));
              }}
            >
              Edit goal
            </button>
          </>
        )}
        {ACTIONS_FOR_STATUS[project.status].map((action) => (
          <button
            key={action}
            type="button"
            onClick={() => {
              setPending(action);
            }}
          >
            {LIFECYCLE_COPY[action].button}
          </button>
        ))}
        {mapActions !== undefined && placed === false && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                mapActions.place(target);
              }}
            >
              Place on map
            </button>
            <button type="button" disabled={busy} onClick={() => void autoPlace()}>
              Auto-place
            </button>
          </>
        )}
        {mapActions !== undefined && placed === true && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setRemoving(true);
            }}
          >
            {REMOVE_FROM_MAP_COPY.button}
          </button>
        )}
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
          fallbackFocus={fallbackFocus}
        />
      )}

      {pending !== null && (
        <ConfirmDialog
          title={LIFECYCLE_COPY[pending].title(project.name)}
          happens={LIFECYCLE_COPY[pending].happens}
          doesNotHappen={LIFECYCLE_COPY[pending].doesNotHappen}
          confirmLabel={LIFECYCLE_COPY[pending].confirm}
          busy={busy}
          onConfirm={() => void confirm(pending)}
          onClose={() => {
            if (!busy) setPending(null);
          }}
          fallbackFocus={fallbackFocus}
        />
      )}
    </li>
  );
}

interface EditFormProps {
  readonly kind: 'name' | 'goal';
  readonly initial: string;
  readonly projectName: string;
  readonly onSave: (value: string) => Promise<ProjectCommandOutcome>;
  readonly onDone: () => void;
}

/** Edits the name or the goal in place. Escape or Cancel closes it without saving. */
function EditForm({ kind, initial, projectName, onSave, onDone }: EditFormProps) {
  const fieldId = useId();
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit() {
    const error = kind === 'name' ? nameProblem(value) : goalProblem(value);
    if (error !== null) {
      setProblem(error);
      return;
    }
    setBusy(true);
    try {
      const outcome = await onSave(value.trim());
      if (outcome.ok) onDone();
      else setProblem(projectCommandProblem(outcome.error));
    } finally {
      setBusy(false);
    }
  }

  const label = kind === 'name' ? `New name for ${projectName}` : `Goal of ${projectName}`;
  return (
    <form
      className="project-edit"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onDone();
      }}
    >
      <label htmlFor={fieldId}>{label}</label>{' '}
      {kind === 'name' ? (
        <input
          id={fieldId}
          value={value}
          maxLength={200}
          autoFocus
          aria-invalid={problem !== null}
          onChange={(event) => {
            setValue(event.target.value);
          }}
        />
      ) : (
        <textarea
          id={fieldId}
          value={value}
          maxLength={4000}
          autoFocus
          aria-invalid={problem !== null}
          onChange={(event) => {
            setValue(event.target.value);
          }}
        />
      )}
      {problem !== null && (
        <p role="alert" className="error">
          {problem}
        </p>
      )}
      <div className="form-actions">
        <button type="submit" disabled={busy}>
          {busy ? 'Saving…' : kind === 'name' ? 'Save name' : 'Save goal'}
        </button>
        <button type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}
