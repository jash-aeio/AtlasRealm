// Repository for `resource_packages` and `resource_dependencies`: the only code that reads or
// writes those tables.
//
// A package record describes one package version (ADR-0036): it is keyed by (package_id,
// version), holds the content digest, and its dependency rows are part of it and never edited.
// One content per id@version per profile: recording the same id@version again is fine when it
// is the same package (another world installs it), and refused when the digest or kind differ.
// Nothing here touches projects, artifacts or grants, and no column holds a secret.
import {
  LicenseId,
  ResourceId,
  ResourceVersion,
  VersionRange,
} from '../../../common/contracts/resource-manifest';
import { type Database, withSavepoint } from '../database';
import {
  charCount,
  integer,
  normalizeName,
  nullableText,
  RepositoryError,
  type Row,
  text,
} from './repository-support';

export const RESOURCE_KINDS = ['agent', 'skill', 'tool'] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export const RESOURCE_SOURCES = ['bundled', 'local', 'github'] as const;
export type ResourceSource = (typeof RESOURCE_SOURCES)[number];

/** `trusted` = bundled with the app, and only bundled packages are trusted. */
export const REVIEW_STATES = ['trusted', 'unreviewed', 'approved', 'blocked'] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

/**
 * `requires`: manifest `requirements.packages`. `default_skill` / `default_tool`: the skills and
 * tools a new instance of an agent starts with (agent packages only).
 */
export const REQUIREMENT_KINDS = ['requires', 'default_skill', 'default_tool'] as const;
export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];

export interface ResourceDependency {
  readonly requirementKind: RequirementKind;
  readonly dependencyId: string;
  readonly versionRange: string;
}

export interface ResourcePackage {
  readonly packageId: string;
  readonly version: string;
  readonly kind: ResourceKind;
  readonly name: string;
  readonly publisher: string;
  readonly source: ResourceSource;
  readonly sourceRevision: string | null;
  readonly digestSha256: string;
  readonly license: string;
  readonly reviewState: ReviewState;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revision: number;
}

export interface NewResourcePackage {
  readonly packageId: string;
  readonly version: string;
  readonly kind: ResourceKind;
  readonly name: string;
  readonly publisher: string;
  readonly source: ResourceSource;
  readonly sourceRevision?: string | null;
  readonly digestSha256: string;
  readonly license: string;
  readonly reviewState: ReviewState;
  readonly dependencies?: readonly ResourceDependency[];
}

/** Manifests allow 20 references per list and three lists; this bounds a forged input. */
const MAX_DEPENDENCIES = 60;
const SOURCE_REVISION_MAX_CHARS = 200;
const SHA256_HEX = /^[0-9a-f]{64}$/;
// A source revision is a git commit, tag or similar: one printable ASCII line.
const SOURCE_REVISION = /^[\x21-\x7e]+$/;

export function oneOf<T extends string>(row: Row, column: string, allowed: readonly T[]): T {
  const value = text(row, column);
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`Column ${column} has an unknown value in database.`);
  }
  return value as T;
}

function toPackage(row: Row): ResourcePackage {
  return {
    packageId: text(row, 'package_id'),
    version: text(row, 'version'),
    kind: oneOf(row, 'kind', RESOURCE_KINDS),
    name: text(row, 'name'),
    publisher: text(row, 'publisher'),
    source: oneOf(row, 'source', RESOURCE_SOURCES),
    sourceRevision: nullableText(row, 'source_revision'),
    digestSha256: text(row, 'digest_sha256'),
    license: text(row, 'license'),
    reviewState: oneOf(row, 'review_state', REVIEW_STATES),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
    revision: integer(row, 'revision'),
  };
}

function toDependency(row: Row): ResourceDependency {
  return {
    requirementKind: oneOf(row, 'requirement_kind', REQUIREMENT_KINDS),
    dependencyId: text(row, 'dependency_id'),
    versionRange: text(row, 'version_range'),
  };
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

export function assertResourceId(value: string, field: string): string {
  if (!ResourceId.safeParse(value).success) {
    throw new RepositoryError(
      'invalid_input',
      `${field} must be a namespaced ID such as "builtin.structured-brief".`,
    );
  }
  return value;
}

export function assertResourceVersion(value: string, field: string): string {
  if (!ResourceVersion.safeParse(value).success) {
    throw new RepositoryError('invalid_input', `${field} must be a version like 1.0.0.`);
  }
  return value;
}

function validate(input: NewResourcePackage): NewResourcePackage & {
  readonly sourceRevision: string | null;
  readonly dependencies: readonly ResourceDependency[];
} {
  assertResourceId(input.packageId, 'Package ID');
  assertResourceVersion(input.version, 'Package version');
  if (!isOneOf(input.kind, RESOURCE_KINDS)) {
    throw new RepositoryError('invalid_input', 'Unknown package kind.');
  }
  if (!isOneOf(input.source, RESOURCE_SOURCES)) {
    throw new RepositoryError('invalid_input', 'Unknown package source.');
  }
  if (!isOneOf(input.reviewState, REVIEW_STATES)) {
    throw new RepositoryError('invalid_input', 'Unknown review state.');
  }
  if ((input.source === 'bundled') !== (input.reviewState === 'trusted')) {
    throw new RepositoryError(
      'invalid_input',
      'Only packages bundled with the app are trusted, and bundled packages always are.',
    );
  }
  const sourceRevision = input.sourceRevision ?? null;
  if (
    sourceRevision !== null &&
    (charCount(sourceRevision) > SOURCE_REVISION_MAX_CHARS || !SOURCE_REVISION.test(sourceRevision))
  ) {
    throw new RepositoryError(
      'invalid_input',
      `Source revision must be 1–${String(SOURCE_REVISION_MAX_CHARS)} printable characters without spaces.`,
    );
  }
  if (!SHA256_HEX.test(input.digestSha256)) {
    throw new RepositoryError('invalid_input', 'Digest must be 64 lowercase hex characters.');
  }
  if (!LicenseId.safeParse(input.license).success) {
    throw new RepositoryError('invalid_input', 'License must be an SPDX identifier.');
  }

  const dependencies = input.dependencies ?? [];
  if (dependencies.length > MAX_DEPENDENCIES) {
    throw new RepositoryError('invalid_input', 'Too many dependencies.');
  }
  const seen = new Set<string>();
  for (const dependency of dependencies) {
    if (!isOneOf(dependency.requirementKind, REQUIREMENT_KINDS)) {
      throw new RepositoryError('invalid_input', 'Unknown requirement kind.');
    }
    if (dependency.requirementKind !== 'requires' && input.kind !== 'agent') {
      throw new RepositoryError(
        'invalid_input',
        'Only agent packages have default skills or tools.',
      );
    }
    assertResourceId(dependency.dependencyId, 'Dependency ID');
    if (!VersionRange.safeParse(dependency.versionRange).success) {
      throw new RepositoryError('invalid_input', 'Version range must look like 1.2.0 or ^1.2.0.');
    }
    if (dependency.dependencyId === input.packageId) {
      throw new RepositoryError('invalid_input', 'A package cannot depend on itself.');
    }
    const key = `${dependency.requirementKind} ${dependency.dependencyId}`;
    if (seen.has(key)) throw new RepositoryError('invalid_input', 'Duplicate dependency.');
    seen.add(key);
  }

  return {
    ...input,
    name: normalizeName(input.name, 'Package name'),
    publisher: normalizeName(input.publisher, 'Publisher'),
    sourceRevision,
    dependencies,
  };
}

export class ResourcePackageRepository {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get(packageId: string, version: string): ResourcePackage | undefined {
    const row = this.db
      .prepare('SELECT * FROM resource_packages WHERE package_id = ? AND version = ?')
      .get(packageId, version);
    return row === undefined ? undefined : toPackage(row);
  }

  /** Every recorded package version, by ID then version text. */
  list(): ResourcePackage[] {
    return this.db
      .prepare('SELECT * FROM resource_packages ORDER BY package_id, version')
      .all()
      .map(toPackage);
  }

  /** What this package version needs, in a stable order. Empty for an unknown package. */
  listDependencies(packageId: string, version: string): ResourceDependency[] {
    return this.db
      .prepare(
        `SELECT * FROM resource_dependencies WHERE package_id = ? AND package_version = ?
         ORDER BY requirement_kind, dependency_id`,
      )
      .all(packageId, version)
      .map(toDependency);
  }

  /**
   * Records a package version with its dependencies, all or nothing. If the same id@version is
   * already recorded with the same digest and kind, returns that record unchanged (installing a
   * package in a second world). Refuses with `already_exists` when the digest or kind differ
   * (one content per id@version, ADR-0036) and `invalid_input` for malformed values.
   */
  record(input: NewResourcePackage): ResourcePackage {
    const clean = validate(input);
    return withSavepoint(this.db, () => {
      const existing = this.get(clean.packageId, clean.version);
      if (existing !== undefined) {
        if (existing.digestSha256 !== clean.digestSha256 || existing.kind !== clean.kind) {
          throw new RepositoryError(
            'already_exists',
            `A different ${clean.packageId} ${clean.version} is already recorded. ` +
              'A changed package needs a new version.',
          );
        }
        return existing;
      }

      const at = this.now().toISOString();
      const row = this.db
        .prepare(
          `INSERT INTO resource_packages (package_id, version, kind, name, publisher, source,
                                          source_revision, digest_sha256, license, review_state,
                                          created_at, updated_at)
           VALUES (:package_id, :version, :kind, :name, :publisher, :source, :source_revision,
                   :digest, :license, :review_state, :at, :at)
           RETURNING *`,
        )
        .get({
          package_id: clean.packageId,
          version: clean.version,
          kind: clean.kind,
          name: clean.name,
          publisher: clean.publisher,
          source: clean.source,
          source_revision: clean.sourceRevision,
          digest: clean.digestSha256,
          license: clean.license,
          review_state: clean.reviewState,
          at,
        });
      if (row === undefined) throw new Error('INSERT … RETURNING returned no row.');

      const insertDependency = this.db.prepare(
        `INSERT INTO resource_dependencies (package_id, package_version, requirement_kind,
                                            dependency_id, version_range, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const dependency of clean.dependencies) {
        insertDependency.run(
          clean.packageId,
          clean.version,
          dependency.requirementKind,
          dependency.dependencyId,
          dependency.versionRange,
          at,
        );
      }
      return toPackage(row);
    });
  }
}
