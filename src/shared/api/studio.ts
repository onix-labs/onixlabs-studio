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
 * A single run/build configuration — the shared, committed unit a user selects and runs. Its optional
 * fields carry the per-language variation (build configuration, target, program, arguments,
 * environment, working directory) the Configure UI edits; the required fields identify it and bind it
 * to the provider that runs it.
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
 * identity fields are missing or malformed and coercing its optional fields.
 * @param value The raw configuration.
 * @returns Returns the configuration, or null when it is unusable.
 */
function parseRunConfiguration(value: unknown): RunConfiguration | null {
  const record: Record<string, unknown> | null = asRecord(value);
  if (record === null) {
    return null;
  }
  const id: string | undefined = optionalString(record, 'id');
  const name: string | undefined = optionalString(record, 'name');
  const providerKind: string | undefined = optionalString(record, 'providerKind');
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
  };
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
