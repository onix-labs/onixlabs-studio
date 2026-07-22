/**
 * The `.studio` project-persistence model and its serialization, kept platform-neutral so both the
 * main process (which reads and writes the files) and the renderer (which edits the configurations)
 * share one contract. The shared `workspace.json` holds the run configurations a team commits; the
 * per-developer `workspace.user.json` holds only transient selections and is git-ignored. Parsing is
 * deliberately defensive: the files are hand-editable and may be edited outside the app, so malformed
 * input degrades to defaults rather than throwing.
 */

/**
 * The name of the folder holding a workspace's persisted studio configuration.
 */
export const STUDIO_DIR: string = '.studio';

/**
 * The name of the shared, committed configuration file.
 */
export const STUDIO_WORKSPACE_FILE: string = 'workspace.json';

/**
 * The name of the per-developer, git-ignored configuration file.
 */
export const STUDIO_USER_FILE: string = 'workspace.user.json';

/**
 * The `.gitignore` pattern seeded so per-developer studio files are never committed.
 */
export const STUDIO_USER_IGNORE: string = '.studio/*.user.json';

/**
 * The current schema version written to both files, so a future format change can be detected.
 */
export const STUDIO_SCHEMA_VERSION: number = 1;

/**
 * Whether a run configuration launches normally or under the debugger.
 */
export type RunMode = 'run' | 'debug';

/**
 * The provider kind stamped on a compound configuration, which is launched by Studio itself (by starting
 * its members) rather than by any one ecosystem's provider.
 */
export const COMPOUND_PROVIDER_KIND: string = 'compound';

/**
 * A single run/build configuration — the shared, committed unit a user selects and runs. Its optional
 * fields carry the per-language variation (build configuration, target, program, arguments,
 * environment, working directory) the Configure UI edits; the required fields identify it and bind it
 * to the provider that runs it.
 *
 * A configuration that names {@link RunConfiguration.members} is a **compound**: it launches those
 * configurations in parallel instead of a command of its own, so "start the database, the back end, and
 * the front end" is one press and each member stays an individually stoppable run.
 */
export interface RunConfiguration {
  /**
   * Gets the stable identifier of the run configuration.
   */
  readonly id: string;

  /**
   * Gets the display name of the run configuration.
   */
  readonly name: string;

  /**
   * Gets the kind of project system that runs this configuration (for example `dotnet`).
   */
  readonly providerKind: string;

  /**
   * Gets the selected build-configuration id (a {@link import('./project-system').BuildConfiguration}
   * id), or undefined when the provider has no build-configuration axis.
   */
  readonly buildConfiguration?: string;

  /**
   * Gets the selected target-option id (a {@link import('./project-system').TargetOption} id), or
   * undefined when the provider has no target axis.
   */
  readonly target?: string;

  /**
   * Gets the program to launch, or undefined to let the provider resolve it.
   */
  readonly program?: string;

  /**
   * Gets the launch arguments, or undefined when there are none.
   */
  readonly args?: readonly string[];

  /**
   * Gets the environment variables to launch with, or undefined when there are none.
   */
  readonly env?: Readonly<Record<string, string>>;

  /**
   * Gets the working directory to launch in, or undefined to use the workspace root.
   */
  readonly cwd?: string;

  /**
   * Gets whether the configuration launches normally or under the debugger.
   */
  readonly mode: RunMode;

  /**
   * Gets the ids of the configurations a compound launches in parallel, or undefined for an ordinary
   * configuration. A compound's own command fields are ignored — its members carry them.
   */
  readonly members?: readonly string[];
}

/**
 * The shared, committed `.studio/workspace.json` model: the run configurations the team shares and the
 * pinned provider selection, when one is set.
 */
export interface StudioWorkspace {
  /**
   * Gets the schema version the file was written with.
   */
  readonly version: number;

  /**
   * Gets the shared run configurations.
   */
  readonly runConfigurations: readonly RunConfiguration[];

  /**
   * Gets the pinned project-system kind for the workspace, or undefined to let detection decide.
   */
  readonly providerKind?: string;
}

/**
 * The per-developer, git-ignored `.studio/workspace.user.json` model: only transient selections — never
 * a redefinition of a shared configuration. This is the whole of the shared-vs-user precedence rule:
 * the user file layers a *selection* over the shared configurations, it does not override their fields.
 */
export interface StudioUser {
  /**
   * Gets the schema version the file was written with.
   */
  readonly version: number;

  /**
   * Gets the id of the last-selected run configuration, or undefined when none was selected.
   */
  readonly selectedRunConfigurationId?: string;

  /**
   * Gets the id of the last-selected target option, or undefined when none was selected.
   */
  readonly lastTarget?: string;

  /**
   * Gets the id of the last-selected build configuration, or undefined when none was selected.
   */
  readonly lastBuildConfiguration?: string;
}

/**
 * The merged view of a workspace's studio configuration: the shared workspace file and the developer's
 * user file, returned together (not deep-merged) so the renderer can layer the transient selections
 * over the shared configurations.
 */
export interface StudioSnapshot {
  /**
   * Gets the shared workspace configuration.
   */
  readonly workspace: StudioWorkspace;

  /**
   * Gets the developer's transient user configuration.
   */
  readonly user: StudioUser;
}

/**
 * Builds an empty shared workspace configuration at the current schema version.
 * @returns Returns the default shared configuration.
 */
export function defaultWorkspace(): StudioWorkspace {
  return { version: STUDIO_SCHEMA_VERSION, runConfigurations: [] };
}

/**
 * Builds an empty user configuration at the current schema version.
 * @returns Returns the default user configuration.
 */
export function defaultUser(): StudioUser {
  return { version: STUDIO_SCHEMA_VERSION };
}

/**
 * Builds an empty snapshot (default shared and user configurations).
 * @returns Returns the default snapshot.
 */
export function emptySnapshot(): StudioSnapshot {
  return { workspace: defaultWorkspace(), user: defaultUser() };
}

/**
 * Reads a defined string field from a record, or undefined when absent or not a non-empty string.
 * @param record The record to read from.
 * @param key The field name.
 * @returns Returns the trimmed string, or undefined.
 */
function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value: unknown = record[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Coerces an unknown value to a plain record, or null when it is not an object.
 * @param value The value to coerce.
 * @returns Returns the record, or null.
 */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Parses a single run configuration defensively, dropping it (returning null) when its required
 * identity fields are missing or malformed and coercing its optional fields. Exported so an authoring
 * path (the agent's run-configuration tools) validates and normalises exactly as the file reader does.
 * @param value The raw configuration.
 * @returns Returns the configuration, or null when it is unusable.
 */
export function parseRunConfiguration(value: unknown): RunConfiguration | null {
  const record: Record<string, unknown> | null = asRecord(value);
  if (record === null) {
    return null;
  }
  const id: string | undefined = optionalString(record, 'id');
  const name: string | undefined = optionalString(record, 'name');
  const members: readonly string[] | undefined = parseMembers(record['members']);
  // A compound is launched by Studio, not by an ecosystem provider, so it needs no authored kind: a
  // hand-written (or agent-written) compound that omits one still parses.
  const providerKind: string | undefined =
    optionalString(record, 'providerKind') ??
    (members === undefined ? undefined : COMPOUND_PROVIDER_KIND);
  if (id === undefined || name === undefined || providerKind === undefined) {
    return null;
  }
  const args: unknown = record['args'];
  const env: Record<string, unknown> | null = asRecord(record['env']);
  return {
    id,
    name,
    providerKind,
    buildConfiguration: optionalString(record, 'buildConfiguration'),
    target: optionalString(record, 'target'),
    program: optionalString(record, 'program'),
    args: Array.isArray(args)
      ? args.filter((arg: unknown): arg is string => typeof arg === 'string')
      : undefined,
    env:
      env === null
        ? undefined
        : Object.fromEntries(
            Object.entries(env).filter(
              (entry: [string, unknown]): entry is [string, string] =>
                typeof entry[1] === 'string',
            ),
          ),
    mode: record['mode'] === 'debug' ? 'debug' : 'run',
    members,
  };
}

/**
 * Parses a compound's member ids, keeping only non-empty strings and dropping the field entirely when
 * nothing usable remains — so an ordinary configuration and a compound whose members were all malformed
 * both read as "not a compound" rather than as an empty compound that launches nothing.
 * @param value The raw `members` value.
 * @returns Returns the member ids, or undefined when there are none.
 */
function parseMembers(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const members: string[] = value.filter(
    (member: unknown): member is string => typeof member === 'string' && member.length > 0,
  );
  return members.length > 0 ? members : undefined;
}

/**
 * Determines whether a configuration is a compound (it launches other configurations rather than a
 * command of its own).
 * @param configuration The configuration to test.
 * @returns Returns true when the configuration is a compound.
 */
export function isCompoundConfiguration(configuration: RunConfiguration): boolean {
  return configuration.members !== undefined && configuration.members.length > 0;
}

/**
 * Expands a configuration into the leaf configurations a Start actually launches: itself for an ordinary
 * configuration, or its members (recursively, since a compound may name another compound) for a
 * compound.
 *
 * Deliberately total rather than throwing: the file is hand-editable, so a member naming nothing is
 * dropped and a cycle — including a compound naming itself — is broken by visiting each configuration at
 * most once. A compound that expands to nothing returns an empty list, and the caller starts nothing.
 * @param configuration The configuration to expand.
 * @param all Every configuration in the workspace, used to resolve member ids.
 * @returns Returns the leaf configurations to launch, in declaration order and without duplicates.
 */
export function expandRunConfiguration(
  configuration: RunConfiguration,
  all: readonly RunConfiguration[],
): readonly RunConfiguration[] {
  const byId: Map<string, RunConfiguration> = new Map<string, RunConfiguration>(
    all.map((candidate: RunConfiguration): [string, RunConfiguration] => [candidate.id, candidate]),
  );
  const leaves: RunConfiguration[] = [];
  const visited: Set<string> = new Set<string>();

  const walk: (current: RunConfiguration) => void = (current: RunConfiguration): void => {
    if (visited.has(current.id)) {
      return;
    }
    visited.add(current.id);
    if (!isCompoundConfiguration(current)) {
      leaves.push(current);
      return;
    }
    for (const memberId of current.members ?? []) {
      const member: RunConfiguration | undefined = byId.get(memberId);
      if (member !== undefined) {
        walk(member);
      }
    }
  };

  walk(configuration);
  return leaves;
}

/**
 * Parses the shared `workspace.json` contents defensively, returning defaults for malformed input and
 * dropping any run configuration that cannot be parsed.
 * @param raw The parsed JSON value (or any value), never trusted.
 * @returns Returns the shared configuration.
 */
export function parseWorkspace(raw: unknown): StudioWorkspace {
  const record: Record<string, unknown> | null = asRecord(raw);
  if (record === null) {
    return defaultWorkspace();
  }
  const version: number =
    typeof record['version'] === 'number' ? record['version'] : STUDIO_SCHEMA_VERSION;
  const rawConfigurations: unknown = record['runConfigurations'];
  const runConfigurations: RunConfiguration[] = Array.isArray(rawConfigurations)
    ? rawConfigurations
        .map(parseRunConfiguration)
        .filter((configuration: RunConfiguration | null): configuration is RunConfiguration =>
          configuration !== null,
        )
    : [];
  return { version, runConfigurations, providerKind: optionalString(record, 'providerKind') };
}

/**
 * Parses the per-developer `workspace.user.json` contents defensively. Only the transient selection
 * fields are read; any other field a hand-edit might add is ignored, enforcing that the user file never
 * redefines a shared configuration.
 * @param raw The parsed JSON value (or any value), never trusted.
 * @returns Returns the user configuration.
 */
export function parseUser(raw: unknown): StudioUser {
  const record: Record<string, unknown> | null = asRecord(raw);
  if (record === null) {
    return defaultUser();
  }
  const version: number =
    typeof record['version'] === 'number' ? record['version'] : STUDIO_SCHEMA_VERSION;
  return {
    version,
    selectedRunConfigurationId: optionalString(record, 'selectedRunConfigurationId'),
    lastTarget: optionalString(record, 'lastTarget'),
    lastBuildConfiguration: optionalString(record, 'lastBuildConfiguration'),
  };
}

/**
 * Serializes a shared configuration to pretty-printed JSON with a trailing newline, so committed files
 * diff cleanly.
 * @param workspace The shared configuration.
 * @returns Returns the file contents.
 */
export function serializeWorkspace(workspace: StudioWorkspace): string {
  return `${JSON.stringify(workspace, null, 2)}\n`;
}

/**
 * Serializes a user configuration to pretty-printed JSON with a trailing newline.
 * @param user The user configuration.
 * @returns Returns the file contents.
 */
export function serializeUser(user: StudioUser): string {
  return `${JSON.stringify(user, null, 2)}\n`;
}

/**
 * Resolves the effective selected run configuration from a snapshot, applying the shared-vs-user
 * precedence: the user's selection wins when it still names an existing shared configuration, otherwise
 * the first shared configuration is used, or null when there are none. The user file can only *select*
 * among shared configurations; a stale selection never invents one.
 * @param snapshot The merged snapshot.
 * @returns Returns the selected configuration, or null when there are none.
 */
export function resolveSelectedRunConfiguration(snapshot: StudioSnapshot): RunConfiguration | null {
  const configurations: readonly RunConfiguration[] = snapshot.workspace.runConfigurations;
  if (configurations.length === 0) {
    return null;
  }
  const selected: RunConfiguration | undefined = configurations.find(
    (configuration: RunConfiguration): boolean =>
      configuration.id === snapshot.user.selectedRunConfigurationId,
  );
  return selected ?? configurations[0];
}

/**
 * Reports what is wrong with a set of run configurations, as human-readable issues an author (a person
 * or an agent) can act on: duplicate ids, compound members that name nothing, and compound cycles.
 *
 * This is the *authoring* check, deliberately stricter than the *reading* path: the file reader is
 * total ({@link expandRunConfiguration} simply drops what it cannot resolve, so a half-edited file
 * still runs what it can), whereas writing a configuration that names a missing member is a mistake
 * worth refusing before it reaches disk.
 * @param configurations The full set to validate.
 * @returns Returns the issues found, empty when the set is sound.
 */
export function findRunConfigurationIssues(
  configurations: readonly RunConfiguration[],
): readonly string[] {
  const issues: string[] = [];
  const byId: Map<string, RunConfiguration> = new Map<string, RunConfiguration>();
  for (const configuration of configurations) {
    if (byId.has(configuration.id)) {
      issues.push(`Duplicate run configuration id "${configuration.id}".`);
    }
    byId.set(configuration.id, configuration);
  }

  for (const configuration of configurations) {
    for (const memberId of configuration.members ?? []) {
      if (memberId === configuration.id) {
        issues.push(`Compound "${configuration.id}" names itself as a member.`);
      } else if (!byId.has(memberId)) {
        issues.push(`Compound "${configuration.id}" names a member "${memberId}" that does not exist.`);
      }
    }
  }

  // Depth-first search over the compound graph, reporting each cycle once (from its lowest-sorting id).
  const state: Map<string, 'visiting' | 'done'> = new Map<string, 'visiting' | 'done'>();
  const walk: (configuration: RunConfiguration, trail: readonly string[]) => void = (
    configuration: RunConfiguration,
    trail: readonly string[],
  ): void => {
    if (state.get(configuration.id) === 'done') {
      return;
    }
    if (state.get(configuration.id) === 'visiting') {
      const cycle: readonly string[] = [...trail.slice(trail.indexOf(configuration.id)), configuration.id];
      issues.push(`Compound cycle: ${cycle.join(' → ')}.`);
      return;
    }
    state.set(configuration.id, 'visiting');
    for (const memberId of configuration.members ?? []) {
      const member: RunConfiguration | undefined = byId.get(memberId);
      if (member !== undefined && member.id !== configuration.id) {
        walk(member, [...trail, configuration.id]);
      }
    }
    state.set(configuration.id, 'done');
  };
  for (const configuration of configurations) {
    walk(configuration, []);
  }

  return [...new Set(issues)];
}
