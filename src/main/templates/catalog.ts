// Builds the template catalog from raw manifest files (M1-5 #32). No Electron imports, so
// tests can feed it any files.
//
// Every file is treated as untrusted JSON, even bundled ones: a bad file is reported as
// unavailable (with the reason) and the rest still load. One broken template must never stop
// the app from starting (PRODUCT_RULES: real status, no crash on bad data).
import { z } from 'zod';

import {
  MAX_PROJECT_TEMPLATES,
  ProjectTemplateManifest,
  TemplateLocation,
  type TemplateSummary,
  type TemplateUnavailableReason,
  UNREADABLE_TEMPLATE_LOCATION,
} from '../../common/contracts/project-template';

export interface UnavailableTemplate {
  /** Folder relative to resources/project-templates, e.g. `generic/1.0.0`. */
  readonly location: string;
  readonly reason: TemplateUnavailableReason;
}

export interface TemplateCatalog {
  readonly available: readonly ProjectTemplateManifest[];
  readonly unavailable: readonly UnavailableTemplate[];
  /** What `template.list` returns: available templates first, then the unavailable ones. */
  readonly summaries: readonly TemplateSummary[];
}

/** Logs why a template is unavailable. Main-process log only, never sent to the renderer. */
export type CatalogLogger = (message: string, detail?: string) => void;

/** `<folder>/<version>`, where the folder is the ID without its `builtin.` prefix. */
const LOCATION = /^([a-z0-9]+(?:-[a-z0-9]+)*)\/([^/]+)$/;

/**
 * Validates each file once. `files` maps a location (`generic/1.0.0`) to the parsed JSON of
 * its `template.json`. Locations are processed in sorted order so the result is the same on
 * every machine; files beyond MAX_PROJECT_TEMPLATES are skipped and reported once.
 */
export function buildTemplateCatalog(
  files: Readonly<Record<string, unknown>>,
  log: CatalogLogger = (message, detail) => {
    console.warn(message, detail ?? '');
  },
): TemplateCatalog {
  const available: ProjectTemplateManifest[] = [];
  const unavailable: UnavailableTemplate[] = [];
  const locations = Object.keys(files).sort();

  const refuse = (location: string, reason: TemplateUnavailableReason, detail?: string) => {
    // The real location goes to the log. The list only gets it if it fits TemplateLocation.
    const shown = TemplateLocation.safeParse(location).success
      ? location
      : UNREADABLE_TEMPLATE_LOCATION;
    unavailable.push({ location: shown, reason });
    log(`[templates] ${JSON.stringify(location)} is unavailable: ${reason}`, detail);
  };

  for (const location of locations.slice(0, MAX_PROJECT_TEMPLATES)) {
    const parsed = ProjectTemplateManifest.safeParse(files[location]);
    if (!parsed.success) {
      refuse(location, 'invalid_manifest', z.prettifyError(parsed.error));
      continue;
    }
    const manifest = parsed.data;
    // The folder must agree with the manifest, so a copied folder with a stale ID or version
    // can't quietly shadow another template. Since locations are unique, this also means no
    // two available templates share an ID and version.
    const match = LOCATION.exec(location);
    if (
      match?.[1] === undefined ||
      manifest.id !== `builtin.${match[1]}` ||
      manifest.version !== match[2]
    ) {
      refuse(location, 'location_mismatch', `manifest says ${manifest.id}@${manifest.version}`);
      continue;
    }
    available.push(manifest);
  }

  const skipped = locations.slice(MAX_PROJECT_TEMPLATES);
  if (skipped[0] !== undefined) {
    refuse(skipped[0], 'too_many_templates', `${String(skipped.length)} file(s) skipped`);
  }

  return {
    available,
    unavailable,
    summaries: [...available.map(summarize), ...unavailable.map(summarizeUnavailable)],
  };
}

function summarize(manifest: ProjectTemplateManifest): TemplateSummary {
  return {
    status: 'available',
    id: manifest.id,
    version: manifest.version,
    name: manifest.name,
    description: manifest.description,
    metadataOnly: manifest.metadataOnly,
    metadataOnlyNote: manifest.metadataOnlyNote,
    inputFields: manifest.inputFields.map(({ key, label, type, required }) => ({
      key,
      label,
      type,
      required,
    })),
    artifactTypes: manifest.artifactTypes.map(({ id, name, format }) => ({ id, name, format })),
    offlineLimitations: [...manifest.offlineLimitations],
  };
}

function summarizeUnavailable(template: UnavailableTemplate): TemplateSummary {
  return { status: 'unavailable', location: template.location, reason: template.reason };
}
