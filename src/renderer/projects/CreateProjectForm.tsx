// Creates a project: pick a bundled template (with its real metadata), then a name and goal.
//
// M1 templates are metadata only (M1-5 #32): `project.create` records the template and takes a
// name and a goal, nothing else. The template's other fields and outputs are shown as what it
// will ask for and produce once workflows exist (M3/M4), so nothing looks more finished than it is.
import { useId, useState } from 'react';

import type { TemplateSummary } from '../../common/contracts/project-template';
import { nameProblem } from '../onboarding/form-messages';
import type { ProjectList, TemplatesState } from './project-list';
import { goalProblem, projectCommandProblem } from './project-messages';

type AvailableTemplate = Extract<TemplateSummary, { status: 'available' }>;

const UNAVAILABLE_REASONS: Record<
  Extract<TemplateSummary, { status: 'unavailable' }>['reason'],
  string
> = {
  invalid_manifest: 'its description file is invalid',
  location_mismatch: 'its folder does not match its ID or version',
  too_many_templates: 'there are more templates than the app loads',
};

/** The template preselected in the form: Generic when available. */
const DEFAULT_TEMPLATE_ID = 'builtin.generic';

interface CreateProjectFormProps {
  readonly id: string;
  readonly list: ProjectList;
  readonly templates: TemplatesState;
  readonly onCreated: (name: string) => void;
  readonly onCancel: () => void;
}

export function CreateProjectForm({
  id,
  list,
  templates,
  onCreated,
  onCancel,
}: CreateProjectFormProps) {
  const nameId = useId();
  const goalId = useId();
  const goalHelpId = useId();
  const available =
    templates.status === 'ready'
      ? templates.templates.filter((t): t is AvailableTemplate => t.status === 'available')
      : [];
  const [chosenKey, setChosenKey] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const chosen =
    available.find((t) => templateKey(t) === chosenKey) ??
    available.find((t) => t.id === DEFAULT_TEMPLATE_ID) ??
    available[0];

  async function submit() {
    if (chosen === undefined) {
      setProblem('Choose a template.');
      return;
    }
    const error = nameProblem(name) ?? goalProblem(goal);
    if (error !== null) {
      setProblem(error);
      return;
    }
    setBusy(true);
    try {
      const outcome = await list.create({
        templateId: chosen.id,
        templateVersion: chosen.version,
        name: name.trim(),
        goal: goal.trim(),
      });
      if (outcome.ok) onCreated(outcome.project.name);
      else setProblem(projectCommandProblem(outcome.error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      id={id}
      className="create-project"
      aria-label="New project"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel();
      }}
    >
      <fieldset>
        <legend>Template</legend>
        {templates.status === 'loading' && <p role="status">Loading templates…</p>}
        {templates.status === 'error' && (
          <p role="alert" className="error">
            Could not read the templates: {templates.error.message}
          </p>
        )}
        {templates.status === 'ready' && available.length === 0 && (
          <p role="alert" className="error">
            No template is available, so a project can&apos;t be created right now.
          </p>
        )}
        {available.map((template) => (
          <TemplateChoice
            key={templateKey(template)}
            template={template}
            checked={chosen !== undefined && templateKey(chosen) === templateKey(template)}
            onChoose={() => {
              setChosenKey(templateKey(template));
            }}
          />
        ))}
        {templates.status === 'ready' &&
          templates.templates.map((template, index) =>
            template.status === 'unavailable' ? (
              <p key={`unavailable-${String(index)}`} className="muted">
                A template in {template.location} is unavailable because{' '}
                {UNAVAILABLE_REASONS[template.reason]}.
              </p>
            ) : null,
          )}
      </fieldset>

      <label htmlFor={nameId}>Project name</label>
      <input
        id={nameId}
        value={name}
        maxLength={200}
        placeholder="e.g. Spring newsletter"
        onChange={(event) => {
          setName(event.target.value);
        }}
      />

      <label htmlFor={goalId}>Goal (optional)</label>
      <textarea
        id={goalId}
        value={goal}
        maxLength={4000}
        aria-describedby={goalHelpId}
        onChange={(event) => {
          setGoal(event.target.value);
        }}
      />
      <p id={goalHelpId} className="muted">
        What this project should achieve. You can change it later.
      </p>

      {problem !== null && (
        <p role="alert" className="error">
          {problem}
        </p>
      )}
      <div className="form-actions">
        <button type="submit" className="primary" disabled={busy || chosen === undefined}>
          {busy ? 'Creating…' : 'Create project'}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function templateKey(template: AvailableTemplate): string {
  return `${template.id}@${template.version}`;
}

interface TemplateChoiceProps {
  readonly template: AvailableTemplate;
  readonly checked: boolean;
  readonly onChoose: () => void;
}

/** One radio button with the template's real metadata as its description. */
function TemplateChoice({ template, checked, onChoose }: TemplateChoiceProps) {
  const detailsId = useId();
  // Name and goal are what M1 asks for; the other fields come with workflows.
  const laterFields = template.inputFields.filter((field) => field.key !== 'goal');
  return (
    <label className="template-choice">
      <input
        type="radio"
        name="project-template"
        checked={checked}
        aria-describedby={detailsId}
        onChange={onChoose}
      />{' '}
      <strong>{template.name}</strong> <span className="muted">version {template.version}</span>
      <span id={detailsId} className="template-details">
        <span className="block">{template.description}</span>
        <span className="block muted">{template.metadataOnlyNote}</span>
        {laterFields.length > 0 && (
          <span className="block">
            Will also ask for (in a later update):{' '}
            {laterFields
              .map((field) => (field.required ? field.label : `${field.label} (optional)`))
              .join(', ')}
            .
          </span>
        )}
        <span className="block">
          Planned outputs:{' '}
          {template.artifactTypes
            .map((artifact) => `${artifact.name} (${artifact.format})`)
            .join(', ')}
          .
        </span>
        {template.offlineLimitations.length > 0 && (
          <span className="block">Offline: {template.offlineLimitations.join(' ')}</span>
        )}
      </span>
    </label>
  );
}
