import { app } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import type { AiWorkspaceExclusions } from '@shared/api/ai-types';
import { sanitizeExcludedCommands } from '@shared/api/excluded-commands';
import { parseWorkspace, STUDIO_DIR, STUDIO_WORKSPACE_FILE } from '@shared/api/studio';
import { logger } from '@shared/electron/logger';

/**
 * The file (under userData) the per-workspace exclusions live in.
 */
const STORE_FILE: string = 'agent-excluded-commands.json';

/**
 * What one workspace keeps: the patterns only this user excludes, and the shared list they last
 * reviewed, which is what lets the repository's list apply.
 */
interface StoredWorkspace {
  readonly private: readonly string[];
  readonly reviewedShared?: readonly string[];
}

/**
 * Gets a list's identity for comparison: its patterns, sorted. A shared list reordered is the same
 * list; one with an entry added or changed is not.
 * @param patterns The canonical patterns.
 * @returns Returns the sorted copy.
 */
function identity(patterns: readonly string[]): readonly string[] {
  return [...patterns].sort();
}

/**
 * Determines whether two canonical lists hold the same patterns.
 * @param left One list.
 * @param right The other.
 * @returns Returns true when they are the same set.
 */
export function sameExclusions(left: readonly string[], right: readonly string[]): boolean {
  const a: readonly string[] = identity(left);
  const b: readonly string[] = identity(right);
  return (
    a.length === b.length &&
    a.every((pattern: string, index: number): boolean => pattern === b[index])
  );
}

/**
 * Owns the per-workspace excluded commands (#1163): the private list a user keeps for one workspace,
 * and which shared list (from the repository's `.studio/workspace.json`) they have reviewed there.
 *
 * Kept in Studio's own data, keyed by workspace root, rather than in the repository: a clone cannot
 * bring a private exclusion with it, and an agent cannot add one by editing a file. The repository's
 * shared list is read from disk at the moment it is needed and applies only while it is exactly the
 * list the user reviewed, so a teammate's commit, a pull or an agent's edit asks again. Best-effort
 * like the other stores: a corrupt or unwritable file forgets rather than crashes.
 */
export class ExcludedCommandStore {
  /**
   * Holds each workspace's stored lists, by root.
   */
  private workspaces: Map<string, StoredWorkspace> = new Map<string, StoredWorkspace>();

  /**
   * Tracks whether the persisted lists have been loaded.
   */
  private loaded: boolean = false;

  /**
   * Initializes a new instance of the {@link ExcludedCommandStore} class.
   * @param readShared Reads a workspace's shared list; injected so the store is testable without one.
   */
  public constructor(
    private readonly readShared: (
      root: string,
    ) => Promise<readonly string[]> = readSharedExclusions,
  ) {}

  /**
   * Reads a workspace's lists, and whether its shared list applies.
   * @param root The workspace root.
   * @returns Returns the lists.
   */
  public async describe(root: string): Promise<AiWorkspaceExclusions> {
    this.ensureLoaded();
    const stored: StoredWorkspace | undefined = this.workspaces.get(root);
    const shared: readonly string[] = await this.readShared(root);
    return {
      workspaceRoot: root,
      private: stored?.private ?? [],
      shared,
      sharedReviewed:
        shared.length > 0 &&
        stored?.reviewedShared !== undefined &&
        sameExclusions(shared, stored.reviewedShared),
    };
  }

  /**
   * Gets the patterns that apply to an agent in a workspace: its private list and, once reviewed, its
   * shared one. The global list from settings is joined to these by the caller.
   * @param root The workspace root, or null for none.
   * @returns Returns the patterns.
   */
  public async applying(root: string | null): Promise<readonly string[]> {
    if (root === null) {
      return [];
    }
    const described: AiWorkspaceExclusions = await this.describe(root);
    return [...described.private, ...(described.sharedReviewed ? described.shared : [])];
  }

  /**
   * Replaces a workspace's private list.
   * @param root The workspace root.
   * @param patterns The new list, never trusted.
   * @returns Returns the workspace's lists as they now are.
   */
  public async setPrivate(root: string, patterns: unknown): Promise<AiWorkspaceExclusions> {
    this.ensureLoaded();
    const current: StoredWorkspace | undefined = this.workspaces.get(root);
    this.workspaces.set(root, {
      ...current,
      private: sanitizeExcludedCommands(patterns),
    });
    this.persist();
    return this.describe(root);
  }

  /**
   * Records the shared list the user reviewed in a workspace. Only a list the file holds right now is
   * recorded: approving something other than what the repository says would let a later edit to the
   * file land on an approval it never had.
   * @param root The workspace root.
   * @param patterns The list the user saw, never trusted.
   * @returns Returns the workspace's lists as they now are.
   */
  public async reviewShared(root: string, patterns: unknown): Promise<AiWorkspaceExclusions> {
    this.ensureLoaded();
    const seen: readonly string[] = sanitizeExcludedCommands(patterns);
    const shared: readonly string[] = await this.readShared(root);
    if (sameExclusions(seen, shared)) {
      const current: StoredWorkspace | undefined = this.workspaces.get(root);
      this.workspaces.set(root, {
        private: current?.private ?? [],
        reviewedShared: identity(seen),
      });
      this.persist();
    } else {
      logger.warn(
        'ExcludedCommandStore',
        `Ignored a review of ${root}'s shared exclusions: the file no longer holds that list`,
      );
    }
    return this.describe(root);
  }

  /**
   * Loads the persisted lists once.
   */
  private ensureLoaded(): void {
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    try {
      const raw: unknown = JSON.parse(readFileSync(this.file(), 'utf8'));
      const workspaces: unknown =
        typeof raw === 'object' && raw !== null
          ? (raw as Record<string, unknown>)['workspaces']
          : null;
      if (typeof workspaces !== 'object' || workspaces === null) {
        return;
      }
      for (const [root, value] of Object.entries(workspaces as Record<string, unknown>)) {
        const record: Record<string, unknown> =
          typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
        this.workspaces.set(root, {
          private: sanitizeExcludedCommands(record['private']),
          ...(Array.isArray(record['reviewedShared'])
            ? { reviewedShared: identity(sanitizeExcludedCommands(record['reviewedShared'])) }
            : {}),
        });
      }
    } catch {
      // A missing file is a fresh install; a corrupt one forgets, and nothing is excluded.
    }
  }

  /**
   * Persists the lists. Best-effort.
   */
  private persist(): void {
    try {
      mkdirSync(dirname(this.file()), { recursive: true });
      writeFileSync(
        this.file(),
        JSON.stringify({ workspaces: Object.fromEntries(this.workspaces) }),
        { encoding: 'utf8', mode: 0o600 },
      );
    } catch (error: unknown) {
      logger.error('ExcludedCommandStore', 'Failed to persist excluded commands', error);
    }
  }

  /**
   * Gets the store file path under userData.
   * @returns Returns the absolute file path.
   */
  private file(): string {
    return join(app.getPath('userData'), STORE_FILE);
  }
}

/**
 * Reads the shared excluded commands a workspace's `.studio/workspace.json` holds, through the same
 * defensive parser every save goes through.
 * @param root The workspace root.
 * @returns Returns the patterns, empty when there is no file or it cannot be read.
 */
export function readSharedExclusions(root: string): Promise<readonly string[]> {
  if (!isAbsolute(root)) {
    return Promise.resolve([]);
  }
  try {
    // Read synchronously, as the other agent stores are: a small file, once per run, and an await on
    // the thread pool here would delay every run's start behind disk I/O for nothing.
    const text: string = readFileSync(join(root, STUDIO_DIR, STUDIO_WORKSPACE_FILE), 'utf8');
    return Promise.resolve(parseWorkspace(JSON.parse(text)).excludedCommands ?? []);
  } catch {
    return Promise.resolve([]);
  }
}
