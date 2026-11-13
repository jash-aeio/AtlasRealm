import { Channels } from '../../../common/contracts/channels';
import { TemplateListInput, TemplateListOutput } from '../../../common/contracts/project-template';
import type { TemplateCatalog } from '../../templates/catalog';
import type { CommandDefinition, CommandHandler } from '../router';

export const templateListCommand = {
  channel: Channels.templateList,
  input: TemplateListInput,
  output: TemplateListOutput,
} satisfies CommandDefinition<typeof TemplateListInput, typeof TemplateListOutput>;

/**
 * Read-only. Returns the summaries the catalog built at startup (templates are validated
 * once, not per call). The list is bounded by MAX_PROJECT_TEMPLATES, so it needs no paging.
 */
export function createTemplateListHandler(
  catalog: TemplateCatalog,
): CommandHandler<typeof TemplateListInput, typeof TemplateListOutput> {
  return () => ({ templates: [...catalog.summaries] });
}
