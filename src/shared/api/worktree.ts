/**
 * The worktree-container model and its serialization, kept platform-neutral so the main process
 * (which owns the disk operations) and the renderer (which presents and edits containers) share one
 * contract. A *worktree* is Studio's product concept — a container directory holding several
 * independent full clones of one repository (each a GUID-named directory on its own branch) plus a
 * `.studio/worktree.json` declaring the container and its checkout registry. It is deliberately not
 * git's `worktree` feature: checkouts share nothing on disk, so any one of them opened directly is an
 * ordinary workspace.
 *
 * The container's `.studio` is unrelated to a checkout's own committed `.studio` (run
 * configurations): the presence of `worktree.json` is what distinguishes container meta from
 * workspace persistence. Parsing is defensive — the file is hand-editable, so malformed input
 * degrades rather than throws — and checkout ids are validated strictly because they are joined into
 * filesystem paths.
 */

/**
 * The name of the container configuration file inside the `.studio` folder. Its presence is what
 * makes a directory a worktree container.
 */
export const WORKTREE_CONFIG_FILE: string = 'worktree.json';

/**
 * The current schema version written to the container configuration.
 */
export const WORKTREE_SCHEMA_VERSION: number = 1;

/**
 * The kind of thing a directory resolves to when opened: a worktree container (its `.studio`
 * declares one), a workspace (a git repository or plain project folder opened directly), or a plain
 * folder with no git presence. Resolution order is container first — a container is never mistaken
 * for the repository its checkouts clone.
 */
export type WorkspaceKind = 'worktree' | 'workspace' | 'folder';

/**
 * A checkout registered in a container: a GUID-named directory holding a full clone. The GUID is the
 * stable disk identity (a checkout's branch changes over its life, so branch-named directories would
 * rot); the UI labels checkouts by branch and optional alias, never by id.
 */
export interface WorktreeCheckout {
  /**
   * Gets the checkout's stable identifier — its directory name under the container.
   */
  readonly id: string;

  /**
   * Gets the user-chosen display label, or undefined to label by branch alone.
   */
  readonly alias?: string;
}

/**
 * The container's `.studio/worktree.json` model: the shared origin its checkouts clone and the
 * checkout registry. The registry is authoritative — a stray directory under the container is not a
 * checkout, and a registered id whose directory is missing is reported, not invented.
 */
export interface WorktreeConfig {
  /**
   * Gets the schema version the file was written with.
   */
  readonly version: number;

  /**
   * Gets the origin URL every checkout clones, or null for a local-only repository (new checkouts
   * then clone from an existing sibling checkout).
   */
  readonly origin: string | null;

  /**
   * Gets the registered checkouts, in registration order.
   */
  readonly checkouts: readonly WorktreeCheckout[];
}

/**
 * A checkout enriched with its live state, as reported to the renderer: where it is on disk, whether
 * the directory actually exists, and the branch its clone currently has checked out.
 */
export interface WorktreeCheckoutInfo {
  /**
   * Gets the checkout's stable identifier.
   */
  readonly id: string;

  /**
   * Gets the user-chosen display label, or undefined to label by branch alone.
   */
  readonly alias?: string;

  /**
   * Gets the checkout's absolute directory path.
   */
  readonly path: string;

  /**
   * Gets whether the checkout's directory exists on disk.
   */
  readonly exists: boolean;

  /**
   * Gets the branch the checkout currently has checked out, or null when it cannot be read (the
   * directory is missing, or not a repository).
   */
  readonly branch: string | null;
}

/**
 * A container described with its live checkout states — the model behind the Worktrees panel.
 */
export interface WorktreeDescriptor {
  /**
   * Gets the container's absolute root path.
   */
  readonly root: string;

  /**
   * Gets the origin URL checkouts clone, or null for a local-only container.
   */
  readonly origin: string | null;

  /**
   * Gets the checkouts with their live state, in registration order.
   */
  readonly checkouts: readonly WorktreeCheckoutInfo[];
}

/**
 * A checkout's lightweight repository status, as shown in the Worktrees panel: how many working-tree
 * entries are changed and how far the branch is ahead of / behind its upstream. Null fields mean the
 * value could not be read (the directory is missing, the clone is damaged, or — for ahead/behind —
 * the branch has no upstream).
 */
export interface WorktreeCheckoutStatus {
  /**
   * Gets the checkout's stable identifier.
   */
  readonly id: string;

  /**
   * Gets the branch the checkout currently has checked out, or null when it cannot be read.
   */
  readonly branch: string | null;

  /**
   * Gets the number of changed working-tree entries, or null when the status cannot be read.
   */
  readonly changes: number | null;

  /**
   * Gets how many commits the branch is ahead of its upstream, or null when it has none.
   */
  readonly ahead: number | null;

  /**
   * Gets how many commits the branch is behind its upstream, or null when it has none.
   */
  readonly behind: number | null;
}

/**
 * The options accepted when adding a checkout: the branch to check out (created when it does not
 * exist) and an optional display alias. Both are optional — a bare add clones the origin's default
 * branch.
 */
export interface WorktreeAddOptions {
  /**
   * Gets the branch to check out in the new clone, or undefined to keep the clone's default.
   */
  readonly branch?: string;

  /**
   * Gets the display alias to register, or undefined to label by branch alone.
   */
  readonly alias?: string;
}

/**
 * The result of a mutating worktree operation: the value on success, or a human-readable reason on
 * failure. Failures are expected outcomes (an unopened root, a clone that could not reach its
 * source), so they travel as data rather than exceptions.
 */
export type WorktreeOutcome<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

/**
 * Builds a successful outcome.
 * @param value The operation's value.
 * @returns Returns the outcome.
 */
export function worktreeOk<T>(value: T): WorktreeOutcome<T> {
  return { ok: true, value };
}

/**
 * Builds a failed outcome.
 * @param error The human-readable reason.
 * @returns Returns the outcome.
 */
export function worktreeError<T>(error: string): WorktreeOutcome<T> {
  return { ok: false, error };
}

/**
 * Mints a new checkout identifier — a random UUID, which is what keeps checkout directory names
 * stable and collision-free.
 * @returns Returns the new identifier.
 */
export function mintCheckoutId(): string {
  return crypto.randomUUID();
}

/**
 * Determines whether a value is safe to use as a checkout identifier. Ids are joined into filesystem
 * paths on the renderer's say-so, so only the exact UUID shape is accepted — anything else (path
 * separators, traversal, an empty string) is rejected.
 * @param value The value to test.
 * @returns Returns true when the value is a well-formed checkout id.
 */
export function isSafeCheckoutId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

/**
 * Builds a container configuration at the current schema version.
 * @param origin The origin URL, or null for a local-only container.
 * @param checkouts The initial checkout registry.
 * @returns Returns the configuration.
 */
export function defaultWorktreeConfig(
  origin: string | null,
  checkouts: readonly WorktreeCheckout[] = [],
): WorktreeConfig {
  return { version: WORKTREE_SCHEMA_VERSION, origin, checkouts };
}

/**
 * Reads a defined string field from a record, or undefined when absent or not a non-empty string.
 * @param record The record to read from.
 * @param key The field name.
 * @returns Returns the string, or undefined.
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
 * Parses a single checkout entry defensively, dropping it (returning null) when its id is not a safe
 * checkout id — an unsafe id must never survive into a path join.
 * @param value The raw entry.
 * @returns Returns the checkout, or null when it is unusable.
 */
function parseCheckout(value: unknown): WorktreeCheckout | null {
  const record: Record<string, unknown> | null = asRecord(value);
  if (record === null || !isSafeCheckoutId(record['id'])) {
    return null;
  }
  return { id: record['id'], alias: optionalString(record, 'alias') };
}

/**
 * Parses the container `worktree.json` contents defensively: malformed input degrades to an empty
 * local-only container, unusable checkout entries are dropped, and duplicate ids keep their first
 * occurrence.
 * @param raw The parsed JSON value (or any value), never trusted.
 * @returns Returns the container configuration.
 */
export function parseWorktreeConfig(raw: unknown): WorktreeConfig {
  const record: Record<string, unknown> | null = asRecord(raw);
  if (record === null) {
    return defaultWorktreeConfig(null);
  }
  const version: number =
    typeof record['version'] === 'number' ? record['version'] : WORKTREE_SCHEMA_VERSION;
  const rawCheckouts: unknown = record['checkouts'];
  const seen: Set<string> = new Set<string>();
  const checkouts: WorktreeCheckout[] = [];
  for (const entry of Array.isArray(rawCheckouts) ? rawCheckouts : []) {
    const checkout: WorktreeCheckout | null = parseCheckout(entry);
    if (checkout !== null && !seen.has(checkout.id)) {
      seen.add(checkout.id);
      checkouts.push(checkout);
    }
  }
  return { version, origin: optionalString(record, 'origin') ?? null, checkouts };
}

/**
 * Serializes a container configuration to pretty-printed JSON with a trailing newline.
 * @param config The container configuration.
 * @returns Returns the file contents.
 */
export function serializeWorktreeConfig(config: WorktreeConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

/**
 * Registers a checkout in a configuration, replacing any existing entry with the same id.
 * @param config The container configuration.
 * @param checkout The checkout to register.
 * @returns Returns the updated configuration.
 */
export function addCheckoutEntry(
  config: WorktreeConfig,
  checkout: WorktreeCheckout,
): WorktreeConfig {
  const others: readonly WorktreeCheckout[] = config.checkouts.filter(
    (existing: WorktreeCheckout): boolean => existing.id !== checkout.id,
  );
  return { ...config, checkouts: [...others, checkout] };
}

/**
 * Removes a checkout from a configuration's registry. Removing an unknown id returns the
 * configuration unchanged.
 * @param config The container configuration.
 * @param id The checkout id to remove.
 * @returns Returns the updated configuration.
 */
export function removeCheckoutEntry(config: WorktreeConfig, id: string): WorktreeConfig {
  return {
    ...config,
    checkouts: config.checkouts.filter((existing: WorktreeCheckout): boolean => existing.id !== id),
  };
}
