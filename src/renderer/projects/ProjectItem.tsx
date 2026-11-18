// One project in the list: its name, status, template and goal as text.
import type { ProjectSummary } from '../../common/contracts/project';
import type { TemplatesState } from './project-list';
import { STATUS_LABELS } from './project-messages';

interface ProjectItemProps {
  readonly project: ProjectSummary;
  readonly templates: TemplatesState;
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

export function ProjectItem({ project, templates }: ProjectItemProps) {
  const headingId = `project-${project.id}`;
  return (
    <li className="project-item" aria-labelledby={headingId} data-project-id={project.id}>
      <div className="project-item-header">
        <h4 id={headingId}>{project.name}</h4>
        <span className="badge" data-testid="project-status">
          {STATUS_LABELS[project.status]}
        </span>
      </div>
      <p className="muted">Template: {templateLabel(project, templates)}</p>
      <p className="project-goal" data-testid="project-goal">
        {project.goal === '' ? <span className="muted">No goal yet.</span> : project.goal}
      </p>
    </li>
  );
}
