import { ipcMain, IpcMainInvokeEvent } from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { StudioChannel } from '@shared/api/studio-channels';
import {
  parseUser,
  parseWorkspace,
  RunConfiguration,
  serializeUser,
  serializeWorkspace,
  STUDIO_DIR,
  STUDIO_SCHEMA_VERSION,
  STUDIO_USER_FILE,
  STUDIO_USER_IGNORE,
  STUDIO_WORKSPACE_FILE,
  StudioSnapshot,
  StudioUser,
  StudioWorkspace,
} from '@shared/api/studio';
import { WorkspaceContext } from '../workspace-context';

/**
 * Reads and writes a workspace's `.studio` persistence on behalf of the renderer, confined to open
 * workspace roots through the shared {@link WorkspaceContext} so the renderer cannot touch `.studio`
 * folders outside the opened workspaces. The shared `workspace.json` and the per-developer
 * `workspace.user.json` are read together into a snapshot and written independently; writes are atomic
 * (written to a temporary sibling then renamed) and the first write seeds the root `.gitignore` so the
 * per-developer file is never committed. The file format and its defensive parsing live in the shared
 * {@link import('@shared/api/studio')} module, kept in step with the renderer.
 */
export class StudioStore {
  /**
   * Holds the shared workspace context tracking the open roots.
   */
  private readonly workspace: WorkspaceContext;

  /**
   * Initializes a new instance of the {@link StudioStore} class.
   * @param workspace The shared workspace context, used to confine every operation to an open root.
   */
  public constructor(workspace: WorkspaceContext) {
    this.workspace = workspace;
  }

  /**
   * Registers the studio IPC handlers. Every handler rejects a root that is not an open workspace.
   */
  public register(): void {
    ipcMain.handle(
      StudioChannel.Load,
      (_event: IpcMainInvokeEvent, root: unknown): Promise<StudioSnapshot | null> =>
        this.load(root),
    );
    ipcMain.handle(
      StudioChannel.SaveWorkspace,
      (_event: IpcMainInvokeEvent, root: unknown, workspace: unknown): Promise<boolean> =>
        this.saveWorkspace(root, workspace),
    );
    ipcMain.handle(
      StudioChannel.SaveUser,
      (_event: IpcMainInvokeEvent, root: unknown, user: unknown): Promise<boolean> =>
        this.saveUser(root, user),
    );
  }

  /**
   * Loads a workspace root's merged snapshot, reading the shared and user files (each defaulting when
   * absent or malformed). Confined to open roots.
   * @param root The candidate workspace root.
   * @returns Returns the snapshot, or null when the root is not open.
   */
  private async load(root: unknown): Promise<StudioSnapshot | null> {
    if (typeof root !== 'string' || !this.workspace.isRoot(root)) {
      return null;
    }
    const directory: string = path.join(root, STUDIO_DIR);
    const workspace: StudioWorkspace = parseWorkspace(
      await this.readJson(path.join(directory, STUDIO_WORKSPACE_FILE)),
    );
    const user: StudioUser = parseUser(
      await this.readJson(path.join(directory, STUDIO_USER_FILE)),
    );
    return { workspace, user };
  }

  /**
   * Writes a workspace root's shared `workspace.json`, sanitising the payload through the shared
   * parser first. Confined to open roots.
   * @param root The candidate workspace root.
   * @param payload The candidate shared configuration, never trusted.
   * @returns Returns true when written, false when the root is not open.
   */
  private async saveWorkspace(root: unknown, payload: unknown): Promise<boolean> {
    if (typeof root !== 'string' || !this.workspace.isRoot(root)) {
      return false;
    }
    const workspace: StudioWorkspace = parseWorkspace(payload);
    await this.write(root, STUDIO_WORKSPACE_FILE, serializeWorkspace(workspace));
    return true;
  }

  /**
   * Writes a workspace root's per-developer `workspace.user.json`, sanitising the payload first.
   * Confined to open roots.
   * @param root The candidate workspace root.
   * @param payload The candidate user configuration, never trusted.
   * @returns Returns true when written, false when the root is not open.
   */
  private async saveUser(root: unknown, payload: unknown): Promise<boolean> {
    if (typeof root !== 'string' || !this.workspace.isRoot(root)) {
      return false;
    }
    const user: StudioUser = parseUser(payload);
    await this.write(root, STUDIO_USER_FILE, serializeUser(user));
    return true;
  }

  /**
   * Seeds a workspace's shared configuration with default run configurations the first time a project
   * opens, when it has no `workspace.json` yet. Idempotent: once a shared file exists (seeded here or
   * authored by the user) it is never overwritten, so this can be called on every project load. Not
   * confined by {@link WorkspaceContext} because it is only called by the main process for a root it has
   * already validated.
   * @param root The workspace root.
   * @param configurations The default run configurations to seed.
   * @returns Returns a promise that resolves once seeding completes (or is skipped).
   */
  public async seedRunConfigurations(
    root: string,
    configurations: readonly RunConfiguration[],
  ): Promise<void> {
    if (configurations.length === 0) {
      return;
    }
    const target: string = path.join(root, STUDIO_DIR, STUDIO_WORKSPACE_FILE);
    if (await this.exists(target)) {
      return;
    }
    await this.write(
      root,
      STUDIO_WORKSPACE_FILE,
      serializeWorkspace({ version: STUDIO_SCHEMA_VERSION, runConfigurations: configurations }),
    );
  }

  /**
   * Determines whether a file exists.
   * @param file The absolute file path.
   * @returns Returns true when the file exists.
   */
  private async exists(file: string): Promise<boolean> {
    try {
      await fs.access(file);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Atomically writes a studio file: ensures the `.studio` directory exists, seeds the root
   * `.gitignore`, writes to a temporary sibling, then renames it over the target so a reader never sees
   * a partial file.
   * @param root The workspace root.
   * @param file The studio file name.
   * @param contents The file contents.
   */
  private async write(root: string, file: string, contents: string): Promise<void> {
    const directory: string = path.join(root, STUDIO_DIR);
    await fs.mkdir(directory, { recursive: true });
    await this.seedGitignore(root);
    const target: string = path.join(directory, file);
    const temporary: string = `${target}.${process.pid}.tmp`;
    await fs.writeFile(temporary, contents, 'utf8');
    await fs.rename(temporary, target);
  }

  /**
   * Ensures the root `.gitignore` ignores the per-developer studio file, appending the pattern when it
   * is absent and leaving the file untouched when it is already present. A missing `.gitignore` is
   * created with just the pattern.
   * @param root The workspace root.
   */
  private async seedGitignore(root: string): Promise<void> {
    const gitignore: string = path.join(root, '.gitignore');
    let existing: string;
    try {
      existing = await fs.readFile(gitignore, 'utf8');
    } catch {
      await fs.writeFile(gitignore, `${STUDIO_USER_IGNORE}\n`, 'utf8');
      return;
    }
    const present: boolean = existing
      .split(/\r?\n/)
      .some((line: string): boolean => line.trim() === STUDIO_USER_IGNORE);
    if (present) {
      return;
    }
    const separator: string = existing.length === 0 || existing.endsWith('\n') ? '' : '\n';
    await fs.appendFile(gitignore, `${separator}${STUDIO_USER_IGNORE}\n`, 'utf8');
  }

  /**
   * Reads and JSON-parses a file, returning null when it is missing or malformed so the caller can
   * default it.
   * @param file The absolute file path.
   * @returns Returns the parsed value, or null.
   */
  private async readJson(file: string): Promise<unknown> {
    try {
      return JSON.parse(await fs.readFile(file, 'utf8'));
    } catch {
      return null;
    }
  }
}
