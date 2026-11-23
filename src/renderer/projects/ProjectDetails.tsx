// The project details panel that "Open" and double-clicking a building show (M2-6 #71). In M2
// "Open" shows the project's details and summary; the project workspace with its tabs and
// the interior arrive in M5 (docs/pm/milestones/M2.md), and the panel says so.
import type { WorldSummary } from '../../common/contracts/world';
import { useStore } from '../state/use-store';
import { placementOf, placementText, type WorldPlacements } from '../world/world-placements';
import { STATUS_LABELS } from './project-messages';
import { useProject } from './use-project';

interface ProjectDetailsProps {
  readonly world: WorldSummary;
  readonly projectId: string;
  readonly placements: WorldPlacements;
  readonly version: number;
}

function when(timestamp: string): string {
  return new Date(timestamp).toLocaleString();
}

export function ProjectDetails({ world, projectId, placements, version }: ProjectDetailsProps) {
  const load = useProject(world.id, projectId, version);
  const placementState = useStore(placements.store);

  if (load.status === 'loading') return <p role="status">Reading the project…</p>;
  if (load.status === 'error') {
    return (
      <p role="alert" className="error">
        {load.error.code === 'not_found'
          ? 'This project is no longer here.'
          : `Could not read the project: ${load.error.message} (${load.error.code})`}
      </p>
    );
  }

  const { project } = load;
  return (
    <div className="project-details" data-testid="project-details" data-project-id={project.id}>
      <h3>{project.name}</h3>
      <dl className="inspector-facts">
        <dt>Status</dt>
        <dd>{STATUS_LABELS[project.status]}</dd>
        <dt>Goal</dt>
        <dd>{project.goal === '' ? <span className="muted">No goal yet</span> : project.goal}</dd>
        <dt>Template</dt>
        <dd>
          {project.templateId} {project.templateVersion}
        </dd>
        <dt>In the world</dt>
        <dd>{placementText(placementOf(placementState, project.id))}</dd>
        <dt>Created</dt>
        <dd>{when(project.createdAt)}</dd>
        <dt>Last changed</dt>
        <dd>{when(project.updatedAt)}</dd>
      </dl>
      <p className="not-built">
        Project workspace: not built yet (planned for M5). Its tabs (Overview, Team, Tasks, Files,
        Automations, Activity, Connections, Settings) and the building&apos;s interior will open
        here.
      </p>
      <p className="muted">
        Rename, archive and the other project actions are in the Projects list.
      </p>
    </div>
  );
}
