import { ipcMain, IpcMainInvokeEvent, OpenDialogReturnValue, WebContents } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CloneChannel, CloneOutcome, CloneRequest } from '@shared/api/clone-channels';
import { redactSecrets, stripUrlCredentials } from '@shared/api/redaction';
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
import type { RepositoryTrustChoice } from '../repository-trust';
import type { CloneTrustAnswer } from '../trust/trust-manager';
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
 * Asks, before a clone, whether the user trusts what it brings in, and records what they said.
 */
export interface CloneTrust {
  /**
   * Asks the user, before anything is downloaded.
   * @param source The address the clone comes from, with any credentials removed.
   * @param destination The folder the clone would create.
   * @returns Returns the user's answer.
   */
  askBeforeClone(source: string, destination: string): Promise<CloneTrustAnswer>;

  /**
   * Records what the user said about the folder the clone made.
   * @param folder The folder.
   * @param choice The decision.
   */
  recordClone(folder: string, choice: RepositoryTrustChoice): void;
}

/**
 * A clone that has been checked and can be made.
 */
interface PreparedClone {
  /**
   * Gets the clone asked for.
   */
  readonly request: CloneRequest;

  /**
   * Gets the folder it creates.
   */
  readonly destination: string;

  /**
   * Gets the plugin that makes it.
   */
  readonly plugin: VersionControlDescriptor;
}

/**
 * Clones repositories into a folder the user chose (#805).
 *
 * A clone's destination cannot be an open workspace yet, so it is confined to a parent folder the user
 * picked in this process's own folder dialog instead. The choice is remembered here, in the user's data
 * folder: the renderer can read it and ask to change it, and can name the new folder inside it, but can
 * never say where that parent is. A successful clone is a trusted path — the user chose to bring it in —
 * so it opens like any folder they opened themselves.
 *
 * Whether its code may run is a separate question (#1504), asked before anything is downloaded, with
 * the address it comes from in front of the user: trust it, don't, or decide once it is open. Closing
 * the question clones nothing.
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
   * @param trust Asks, before a clone, whether the user trusts what it brings in.
   */
  public constructor(
    private readonly file: string,
    private readonly window: () => Electron.BrowserWindow | null,
    private readonly versionControl: VersionControlHost,
    private readonly trusted: TrustedPaths,
    private readonly trust: CloneTrust,
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
      (_event: IpcMainInvokeEvent, request: unknown): Promise<CloneOutcome> =>
        this.cloneAsking(request),
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
   * Clones a repository the user asked for in Studio into the chosen parent folder, having first asked
   * whether they trust it (#1504). Nothing is downloaded until they answer, and closing the question
   * clones nothing.
   * @param request The untrusted request.
   * @returns Returns where the result is, or why there is none.
   */
  public async cloneAsking(request: unknown): Promise<CloneOutcome> {
    const prepared: PreparedClone | string = this.prepare(request);
    if (typeof prepared === 'string') {
      return { ok: false, error: prepared };
    }
    const answer: CloneTrustAnswer = await this.trust.askBeforeClone(
      stripUrlCredentials(prepared.request.url),
      prepared.destination,
    );
    if (answer === 'cancel') {
      logger.info('CloneManager', `Clone into ${prepared.destination} cancelled before it began`);
      return {
        ok: false,
        error: 'The clone was cancelled. Nothing was downloaded.',
        cancelled: true,
      };
    }
    const outcome: CloneOutcome = await this.run(prepared);
    if (outcome.ok && answer !== 'later') {
      this.trust.recordClone(outcome.path, answer);
    }
    return outcome;
  }

  /**
   * Clones a repository into the chosen parent folder, asking nothing: for a new project's repository,
   * which Studio made for the user and records as trusted itself.
   * @param request The untrusted request.
   * @param into The folder to clone into in place of the chosen one: a new project's, which the main
   * process's own dialog chose. Never from a renderer.
   * @returns Returns where the result is, or why there is none.
   */
  public async clone(request: unknown, into?: string): Promise<CloneOutcome> {
    const prepared: PreparedClone | string = this.prepare(request, into);
    return typeof prepared === 'string' ? { ok: false, error: prepared } : this.run(prepared);
  }

  /**
   * Checks a clone can be made: the request is well formed, there is a folder to clone into, the new
   * folder's name is free, and a plugin can clone.
   * @param request The untrusted request.
   * @param into The folder to clone into in place of the chosen one, or undefined for the chosen one.
   * @returns Returns the clone to make, or why it cannot be.
   */
  private prepare(request: unknown, into?: string): PreparedClone | string {
    const parsed: CloneRequest | string = parseRequest(request);
    if (typeof parsed === 'string') {
      return parsed;
    }
    const parent: string | null = into ?? this.parent();
    if (parent === null) {
      return 'Choose a folder to clone into first.';
    }
    const destination: string = path.join(parent, parsed.name);
    if (fs.existsSync(destination)) {
      return `${destination} already exists. Choose another name.`;
    }
    const plugin: VersionControlDescriptor | null = this.versionControl.preferredPlugin();
    if (plugin === null) {
      return 'No version-control plugin is installed. Install Git from the Plugin Manager.';
    }
    return { request: parsed, destination, plugin };
  }

  /**
   * Makes a clone that has been checked.
   * @param prepared The clone.
   * @returns Returns where the result is, or why there is none.
   */
  private async run(prepared: PreparedClone): Promise<CloneOutcome> {
    const { request: parsed, destination, plugin } = prepared;
    if (fs.existsSync(destination)) {
      // Something took the name while the user was answering.
      return { ok: false, error: `${destination} already exists. Choose another name.` };
    }
    // A URL may carry a token (`https://user:token@host/…`). It is used as given, since that is how
    // the user chose to authenticate, but it is never written down: not in the log, which the System
    // Monitor's agent reads, and not in an error, which the renderer shows (audit S7).
    logger.info(
      'CloneManager',
      `Cloning ${stripUrlCredentials(parsed.url)} into ${destination} (${parsed.layout}${parsed.branch === undefined ? '' : `, ${parsed.branch}`})`,
    );
    const outcome: CloneOutcome =
      parsed.layout === 'worktree'
        ? await this.cloneAsWorktree(plugin, parsed, destination)
        : await this.cloneFlat(plugin, parsed, destination);
    if (outcome.ok) {
      this.trusted.remember(outcome.path);
      logger.info('CloneManager', `Cloned into ${outcome.path}`);
      return outcome;
    }
    // The plugin's error can echo the command line it ran, URL and all, and so can git's own output.
    const error: string = redactSecrets(outcome.error);
    logger.warn('CloneManager', `Clone failed: ${error}`);
    return {
      ok: false,
      error,
      ...(outcome.code === undefined ? {} : { code: outcome.code }),
      ...(outcome.sshHost === undefined ? {} : { sshHost: outcome.sshHost }),
      ...(outcome.output === undefined ? {} : { output: redactSecrets(outcome.output) }),
    };
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
        ...cloneFlags(request),
      },
    );
    return cloned.ok ? { ok: true, path: destination } : cloneFailure(cloned);
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
        ...cloneFlags(request),
      },
    );
    if (!cloned.ok) {
      fs.rmSync(destination, { recursive: true, force: true });
      return cloneFailure(cloned);
    }
    try {
      const studio: string = path.join(destination, STUDIO_DIR);
      fs.mkdirSync(studio, { recursive: true });
      // The container remembers where its checkouts come from, not how the first one authenticated:
      // a token in the URL would otherwise sit in a file on disk for as long as the container exists.
      fs.writeFileSync(
        path.join(studio, WORKTREE_CONFIG_FILE),
        serializeWorktreeConfig(defaultWorktreeConfig(stripUrlCredentials(request.url), [{ id }])),
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
  const { url, name, layout, branch, submodules, shallow } = value as Record<string, unknown>;
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
  if (
    (submodules !== undefined && typeof submodules !== 'boolean') ||
    (shallow !== undefined && typeof shallow !== 'boolean')
  ) {
    return 'The clone options are not understood.';
  }
  return {
    url: url.trim(),
    name,
    layout: layout,
    ...(branch === undefined ? {} : { branch }),
    ...(submodules === true ? { submodules } : {}),
    ...(shallow === true ? { shallow } : {}),
  };
}

/**
 * Carries a plugin's failed clone over as a clone outcome, with the code, server and output an SSH
 * failure comes with (#1255), so the renderer can word it. The server is passed on unchecked: the
 * renderer checks it before it builds a command from it.
 * @param cloned The plugin's failed answer.
 * @returns Returns the outcome.
 */
function cloneFailure(
  cloned: Extract<VersionControlResponse<'clone'>, { ok: false }>,
): CloneOutcome {
  return {
    ok: false,
    error: cloned.error,
    ...(cloned.code === undefined ? {} : { code: cloned.code }),
    ...(cloned.sshHost === undefined ? {} : { sshHost: cloned.sshHost }),
    ...(typeof cloned.output === 'string' ? { output: cloned.output } : {}),
  };
}

/**
 * Maps a clone's options onto the version-control plugin's clone parameters: submodules cloned too,
 * and a shallow clone fetching one commit of history.
 * @param request The clone.
 * @returns Returns the parameters to add.
 */
function cloneFlags(request: CloneRequest): { recurseSubmodules?: boolean; depth?: number } {
  return {
    ...(request.submodules === true ? { recurseSubmodules: true } : {}),
    ...(request.shallow === true ? { depth: 1 } : {}),
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
