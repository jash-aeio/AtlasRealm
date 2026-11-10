// The templates that ship with the app (M1-5 #32).
//
// Vite bundles every resources/project-templates/<folder>/<version>/template.json into the
// main-process build, the same way the renderer bundles the asset manifest. So the files reach
// dev, tests and the installer with no packaging config and no file paths at runtime.
// A JSON syntax error fails the build; everything else is checked at startup by the catalog.
// Templates installed by the user (later milestones) will need their own loader from disk.
import { buildTemplateCatalog, type CatalogLogger, type TemplateCatalog } from './catalog';

const PREFIX = '../../../resources/project-templates/';
const SUFFIX = '/template.json';

const BUNDLED_FILES = import.meta.glob<unknown>(
  '../../../resources/project-templates/*/*/template.json',
  { eager: true, import: 'default' },
);

/** Bundled template files keyed by location, e.g. `generic/1.0.0`. */
export function bundledTemplateFiles(): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(BUNDLED_FILES).map(([path, json]) => [
      path.slice(PREFIX.length, -SUFFIX.length),
      json,
    ]),
  );
}

/** Validates the bundled templates. Call once at startup and keep the result. */
export function loadBundledTemplateCatalog(log?: CatalogLogger): TemplateCatalog {
  return buildTemplateCatalog(bundledTemplateFiles(), log);
}
