// `project.*` commands (M1-7 #34). Thin wrappers: the router has already checked the sender,
// schema and size; ProjectService checks ownership, templates and limits; repository errors
// are mapped to stable command errors on the way out.
import { Channels } from '../../../common/contracts/channels';
import {
  ProjectCreateInput,
  ProjectGetInput,
  ProjectLifecycleInput,
  ProjectLifecycleOutput,
  ProjectListInput,
  ProjectListOutput,
  ProjectOutput,
  ProjectRenameInput,
  ProjectUpdateGoalInput,
} from '../../../common/contracts/project';
import type { ProjectService } from '../../services/project-service';
import { withRepositoryErrors } from '../repository-errors';
import type { CommandDefinition, CommandHandler } from '../router';

export const projectCreateCommand = {
  channel: Channels.projectCreate,
  input: ProjectCreateInput,
  output: ProjectOutput,
} satisfies CommandDefinition<typeof ProjectCreateInput, typeof ProjectOutput>;

export const projectGetCommand = {
  channel: Channels.projectGet,
  input: ProjectGetInput,
  output: ProjectOutput,
} satisfies CommandDefinition<typeof ProjectGetInput, typeof ProjectOutput>;

export const projectListCommand = {
  channel: Channels.projectList,
  input: ProjectListInput,
  output: ProjectListOutput,
} satisfies CommandDefinition<typeof ProjectListInput, typeof ProjectListOutput>;

export const projectRenameCommand = {
  channel: Channels.projectRename,
  input: ProjectRenameInput,
  output: ProjectOutput,
} satisfies CommandDefinition<typeof ProjectRenameInput, typeof ProjectOutput>;

export const projectUpdateGoalCommand = {
  channel: Channels.projectUpdateGoal,
  input: ProjectUpdateGoalInput,
  output: ProjectOutput,
} satisfies CommandDefinition<typeof ProjectUpdateGoalInput, typeof ProjectOutput>;

export const projectArchiveCommand = {
  channel: Channels.projectArchive,
  input: ProjectLifecycleInput,
  output: ProjectLifecycleOutput,
} satisfies CommandDefinition<typeof ProjectLifecycleInput, typeof ProjectLifecycleOutput>;

export const projectRestoreCommand = {
  channel: Channels.projectRestore,
  input: ProjectLifecycleInput,
  output: ProjectOutput,
} satisfies CommandDefinition<typeof ProjectLifecycleInput, typeof ProjectOutput>;

export const projectTrashCommand = {
  channel: Channels.projectTrash,
  input: ProjectLifecycleInput,
  output: ProjectLifecycleOutput,
} satisfies CommandDefinition<typeof ProjectLifecycleInput, typeof ProjectLifecycleOutput>;

export const projectRestoreFromTrashCommand = {
  channel: Channels.projectRestoreFromTrash,
  input: ProjectLifecycleInput,
  output: ProjectOutput,
} satisfies CommandDefinition<typeof ProjectLifecycleInput, typeof ProjectOutput>;

type Handler<D> = D extends CommandDefinition<infer I, infer O> ? CommandHandler<I, O> : never;

export function createProjectCreateHandler(
  service: ProjectService,
): Handler<typeof projectCreateCommand> {
  return (input) => withRepositoryErrors(() => ({ project: service.create(input) }));
}

export function createProjectGetHandler(
  service: ProjectService,
): Handler<typeof projectGetCommand> {
  return ({ worldId, projectId }) =>
    withRepositoryErrors(() => ({ project: service.get(worldId, projectId) }));
}

export function createProjectListHandler(
  service: ProjectService,
): Handler<typeof projectListCommand> {
  return (input) =>
    withRepositoryErrors(() => {
      const page = service.list(input);
      return { projects: [...page.projects], nextCursor: page.nextCursor };
    });
}

export function createProjectRenameHandler(
  service: ProjectService,
): Handler<typeof projectRenameCommand> {
  return ({ name, ...change }) =>
    withRepositoryErrors(() => ({ project: service.rename(change, name) }));
}

export function createProjectUpdateGoalHandler(
  service: ProjectService,
): Handler<typeof projectUpdateGoalCommand> {
  return ({ goal, ...change }) =>
    withRepositoryErrors(() => ({ project: service.updateGoal(change, goal) }));
}

export function createProjectArchiveHandler(
  service: ProjectService,
): Handler<typeof projectArchiveCommand> {
  return (change) => withRepositoryErrors(() => service.archive(change));
}

export function createProjectRestoreHandler(
  service: ProjectService,
): Handler<typeof projectRestoreCommand> {
  return (change) => withRepositoryErrors(() => ({ project: service.restore(change) }));
}

export function createProjectTrashHandler(
  service: ProjectService,
): Handler<typeof projectTrashCommand> {
  return (change) => withRepositoryErrors(() => service.trash(change));
}

export function createProjectRestoreFromTrashHandler(
  service: ProjectService,
): Handler<typeof projectRestoreFromTrashCommand> {
  return (change) => withRepositoryErrors(() => ({ project: service.restoreFromTrash(change) }));
}
