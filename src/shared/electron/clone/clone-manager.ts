import { ipcMain, IpcMainInvokeEvent, OpenDialogReturnValue, WebContents } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CloneChannel, CloneOutcome, CloneRequest } from '@shared/api/clone-channels';
import { STUDIO_DIR } from '@shared/api/studio';
import type { VersionControlResponse } from '@shared/api/version-control-protocol';
import {
  defaultWorktreeConfig,
  mintCheckoutId,
  serializeWorktreeConfig,
  WORKTREE_CONFIG_FILE,
} from '@shared/api/worktree';
import { showOpenDialog } from '../dialog-parent';
import { logger } from '../logger';
import type { TrustedPaths } from '../trusted-paths';
import type { VersionControlHost } from '../version-control/version-control-host';
import type { VersionControlDescriptor } from '../version-control/version-control-descriptor';

/**
 * The remote URL schemes a clone may name. A local path or a `file://` URL would let a clone copy any
 * folder on the machine into the destination, which is not what "clone a repository" offers.
 */
const REMOTE_URL: RegExp = /^(?:https?:\/\/|ssh:\/\/|git:\/\/|[\w.-]+@[\w.-]+:)/i;

/**
 * The folder names a clone may create: one path segment, nothing a shell or git would read as more.
 */
const FOLDER_NAME: RegExp = /^(?!\.{1,2}$)[\w.-]+$/;

/**
 * Clones repositories into a folder the user chose (#805).
 *
 * A clone's destination cannot be an open workspace yet, so it is confined to a parent folder the user
 * picked in this process's own folder dialog instead. The choice is remembered here, in the user's data
 * folder: the renderer can read it and ask to change it, and can name the new folder inside it, but can
 * never say where that parent is. A successful clone is trusted — the user chose to bring it in — so it
 * opens like any folder they opened themselves.
 */
export class CloneManager {
  /**
   * Holds the remembered parent folder, or null.
   */
  private chosen: string | null;

  /**
   * Initializes the manager.
   * @param file The file the parent folder is remembered in.
   * @param window Gets the window a dialog belongs to when no sender is known.
   * @param versionControl The version-control host, which runs the clone.
   * @param trusted The trusted paths, which the result joins.
   */
  public constructor(
    private readonly file: string,
    private readonly window: () => Electron.BrowserWindow | null,
    private readonly versionControl: VersionControlHost,
    private readonly trusted: TrustedPaths,
  ) {
    this.chosen = load(file);
  }

  /**
   * Registers the cloning IPC handlers.
   */
  public register(): void {
    ipcMain.handle(CloneChannel.Parent, (): string | null => this.parent());
    ipcMain.handle(CloneChannel.PickParent, (event: IpcMainInvokeEvent): Promise<string | null> =>
      this.pickParent(event.sender),
    );
    ipcMain.handle(
      CloneChannel.Clone,
      (_event: IpcMainInvokeEvent, request: unknown): Promise<CloneOutcome> => this.clone(request),
    );
  }

  /**
   * Gets the remembered parent folder, when it still exists.
   * @returns Returns its path, or null.
   */
  public parent(): string | null {
    return this.chosen !== null && isDirectory(this.chosen) ? this.chosen : null;
  }

  /**
   * Asks the user to choose the parent folder, and remembers it.
   * @param sender The web contents that asked, whose window the dialog belongs to.
   * @returns Returns the chosen folder, or null when the dialog was cancelled.
   */
  public async pickParent(sender: WebContents): Promise<string | null> {
    const result: OpenDialogReturnValue = await showOpenDialog(sender, this.window, {
      title: 'Choose where to clone repositories',
      buttonLabel: 'Choose',
      properties: ['openDirectory', 'createDirectory'],
      ...(this.parent() === null ? {} : { defaultPath: this.parent() ?? undefined }),
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    this.chosen = path.resolve(result.filePaths[0]);
    save(this.file, this.chosen);
    logger.info('CloneManager', `Clones go into ${this.chosen}`);
    return this.chosen;
  }

  /**
   * Clones a repository into the chosen parent folder.
   * @param request The untrusted request.
   * @returns Returns where the result is, or why there is none.
   */
  public async clone(request: unknown): Promise<CloneOutcome> {
    const parsed: CloneRequest | string = parseRequest(request);
    if (typeof parsed === 'string') {
      return { ok: false, error: parsed };
    }
    const parent: string | null = this.parent();
    if (parent === null) {
      return { ok: false, error: 'Choose a folder to clone into first.' };
    }
    const destination: string = path.join(parent, parsed.name);
    if (fs.existsSync(destination)) {
      return { ok: false, error: `${destination} already exists. Choose another name.` };
    }
    const plugin: VersionControlDescriptor | null = this.versionControl.preferredPlugin();
    if (plugin === null) {
      return {
        ok: false,
        error: 'No version-control plugin is installed. Install Git from the Plugin Manager.',
      };
    }
    logger.info(
      'CloneManager',
      `Cloning ${parsed.url} into ${destination} (${parsed.layout}${parsed.branch === undefined ? '' : `, ${parsed.branch}`})`,
    );
    const outcome: CloneOutcome =
      parsed.layout === 'worktree'
        ? await this.cloneAsWorktree(plugin, parsed, destination)
        : await this.cloneFlat(plugin, parsed, destination);
    if (outcome.ok) {
      this.trusted.remember(outcome.path);
      logger.info('CloneManager', `Cloned into ${outcome.path}`);
    } else {
      logger.warn('CloneManager', `Clone failed: ${outcome.error}`);
    }
    return outcome;
  }

  /**
   * Clones into the destination as a plain repository.
   * @param plugin The plugin that clones.
   * @param request The clone.
   * @param destination The folder to create.
   * @returns Returns the outcome.
   */
  private async cloneFlat(
    plugin: VersionControlDescriptor,
    request: CloneRequest,
    destination: string,
  ): Promise<CloneOutcome> {
    const cloned: VersionControlResponse<'clone'> = await this.versionControl.cloneToChosenFolder(
      plugin.id,
      {
        url: request.url,
        directory: destination,
        ...(request.branch === undefined ? {} : { branch: request.branch }),
      },
    );
    return cloned.ok ? { ok: true, path: destination } : { ok: false, error: cloned.error };
  }

  /**
   * Creates a worktree container at the destination, with the clone as its first checkout. A failed
   * clone removes the container it created, so a retry finds the name free.
   * @param plugin The plugin that clones.
   * @param request The clone.
   * @param destination The container folder to create.
   * @returns Returns the outcome.
   */
  private async cloneAsWorktree(
    plugin: VersionControlDescriptor,
    request: CloneRequest,
    destination: string,
  ): Promise<CloneOutcome> {
    const id: string = mintCheckoutId();
    try {
      fs.mkdirSync(destination);
    } catch (error: unknown) {
      return { ok: false, error: `The folder could not be created: ${message(error)}` };
    }
    const cloned: VersionControlResponse<'clone'> = await this.versionControl.cloneToChosenFolder(
      plugin.id,
      {
        url: request.url,
        directory: path.join(destination, id),
        ...(request.branch === undefined ? {} : { branch: request.branch }),
      },
    );
    if (!cloned.ok) {
      fs.rmSync(destination, { recursive: true, force: true });
      return { ok: false, error: cloned.error };
    }
    try {
      const studio: string = path.join(destination, STUDIO_DIR);
      fs.mkdirSync(studio, { recursive: true });
      fs.writeFileSync(
        path.join(studio, WORKTREE_CONFIG_FILE),
        serializeWorktreeConfig(defaultWorktreeConfig(request.url, [{ id }])),
        'utf8',
      );
    } catch (error: unknown) {
      return {
        ok: false,
        error: `The clone was made, but the container could not be set up: ${message(error)}`,
      };
    }
    return { ok: true, path: destination };
  }
}

/**
 * Validates a clone request from the renderer, which is treated as hostile: the URL must name a remote
 * and must not read as an option, the folder name must be one plain segment, and a branch must not
 * read as an option either.
 * @param value The untrusted request.
 * @returns Returns the request, or why it is refused.
 */
export function parseRequest(value: unknown): CloneRequest | string {
  if (typeof value !== 'object' || value === null) {
    return 'No clone was described.';
  }
  const { url, name, layout, branch } = value as Record<string, unknown>;
  if (typeof url !== 'string' || !REMOTE_URL.test(url.trim()) || /\s/.test(url.trim())) {
    return 'That is not a repository URL Studio can clone.';
  }
  if (typeof name !== 'string' || !FOLDER_NAME.test(name)) {
    return 'The folder name must be a single name, without slashes.';
  }
  if (layout !== 'flat' && layout !== 'worktree') {
    return 'Choose a flat repository or a worktree.';
  }
  if (branch !== undefined && (typeof branch !== 'string' || !/^[^-\s][^\s]*$/.test(branch))) {
    return 'That is not a branch name.';
  }
  return {
    url: url.trim(),
    name,
    layout: layout,
    ...(branch === undefined ? {} : { branch }),
  };
}

/**
 * Reads the remembered parent folder.
 * @param file The file.
 * @returns Returns the folder, or null.
 */
function load(file: string): string | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    const parent: unknown = (parsed as { parent?: unknown } | null)?.parent;
    return typeof parent === 'string' && path.isAbsolute(parent) ? parent : null;
  } catch {
    return null;
  }
}

/**
 * Remembers the parent folder.
 * @param file The file.
 * @param parent The folder.
 */
function save(file: string, parent: string): void {
  try {
    fs.writeFileSync(file, JSON.stringify({ parent }), 'utf8');
  } catch (error: unknown) {
    logger.warn('CloneManager', `The clone folder could not be remembered: ${message(error)}`);
  }
}

/**
 * Determines whether a path is an existing directory.
 * @param target The path.
 * @returns Returns true when it is.
 */
function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Words an error for the user.
 * @param error The error.
 * @returns Returns its message.
 */
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
