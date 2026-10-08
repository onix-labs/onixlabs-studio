import { ipcMain, IpcMainInvokeEvent, OpenDialogReturnValue, WebContents } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CloneOutcome } from '@shared/api/clone-channels';
import type { ForgeResult } from '@shared/api/forge-types';
import type { HostedRepository } from '@shared/api/hosting-protocol';
import type { CloneLayout } from '@shared/api/clone-channels';
import {
  NewProjectChannel,
  NewProjectOutcome,
  NewProjectRequest,
  PickedDocuments,
  ProjectDocument,
} from '@shared/api/new-project-channels';
import { STUDIO_DIR } from '@shared/api/studio';
import type { VersionControlResponse } from '@shared/api/version-control-protocol';
import {
  defaultWorktreeConfig,
  mintCheckoutId,
  serializeWorktreeConfig,
  WORKTREE_CONFIG_FILE,
} from '@shared/api/worktree';
import type { CloneManager } from '../clone/clone-manager';
import { showOpenDialog } from '../dialog-parent';
import type { HostingManager } from '../hosting/hosting-manager';
import { logger } from '../logger';
import type { TrustedPaths } from '../trusted-paths';
import type { VersionControlDescriptor } from '../version-control/version-control-descriptor';
import type { VersionControlHost } from '../version-control/version-control-host';

/**
 * The folder names a project may have: one path segment, nothing a shell or git would read as more. The
 * same rule as a clone's.
 */
const FOLDER_NAME: RegExp = /^(?!\.{1,2}$)[\w.-]+$/;

/**
 * Creates new projects from the welcome screen's Create Something form (#806).
 *
 * A project is made where clones go — the parent folder the user chose in this process's own dialog —
 * so the renderer names the project but never where it is, exactly as with a clone. With no repository
 * the folder is simply made. With a local one the version-control plugin makes it — in the folder, or
 * as a worktree container's first checkout, with no origin. With a hosted one the code host makes the repository first and the
 * project is a clone of it, in the layout the user picked, so a new project and a cloned one are laid
 * out alike. Either way the folder is trusted: the user asked for it, so it opens like one they opened.
 */
export class NewProjectManager {
  /**
   * Initializes the manager.
   * @param clones The clone manager, which knows the parent folder and makes the clone.
   * @param hosting The hosting manager, which asks the code host for the repository.
   * @param versionControl The version-control host, which makes a local repository.
   * @param trusted The trusted paths, which a new folder joins.
   * @param window Gets the window a dialog belongs to when no sender is known.
   */
  public constructor(
    private readonly clones: CloneManager,
    private readonly hosting: HostingManager,
    private readonly versionControl: VersionControlHost,
    private readonly trusted: TrustedPaths,
    private readonly window: () => Electron.BrowserWindow | null = (): null => null,
  ) {}

  /**
   * Registers the project IPC handlers.
   */
  public register(): void {
    ipcMain.handle(
      NewProjectChannel.Create,
      (_event: IpcMainInvokeEvent, request: unknown): Promise<NewProjectOutcome> =>
        this.create(request),
    );
    ipcMain.handle(
      NewProjectChannel.PickDocuments,
      (event: IpcMainInvokeEvent): Promise<PickedDocuments> => this.pickDocuments(event.sender),
    );
  }

  /**
   * Asks the user for supporting documents, in this process's own dialog, and reads them: the
   * renderer never names a path, so it can read only what the user picked.
   * @param sender The web contents that asked, whose window the dialog belongs to.
   * @returns Returns what was read and what was left out; nothing when the dialog was cancelled.
   */
  public async pickDocuments(sender: WebContents): Promise<PickedDocuments> {
    const result: OpenDialogReturnValue = await showOpenDialog(sender, this.window, {
      title: 'Choose supporting documents',
      buttonLabel: 'Attach',
      properties: ['openFile', 'multiSelections'],
    });
    return result.canceled ? { documents: [], skipped: [] } : readDocuments(result.filePaths);
  }

  /**
   * Creates a project in the chosen parent folder.
   * @param request The untrusted request.
   * @returns Returns where the project is, or why there is none.
   */
  public async create(request: unknown): Promise<NewProjectOutcome> {
    const parsed: NewProjectRequest | string = parseProjectRequest(request);
    if (typeof parsed === 'string') {
      return { ok: false, error: parsed };
    }
    const parent: string | null = this.clones.parent();
    if (parent === null) {
      return { ok: false, error: 'Choose where the project goes first.' };
    }
    const destination: string = path.join(parent, parsed.name);
    if (fs.existsSync(destination)) {
      return { ok: false, error: `${destination} already exists. Choose another name.` };
    }
    logger.info('NewProjectManager', `Creating ${destination} (${parsed.repository.kind})`);
    const outcome: NewProjectOutcome =
      parsed.repository.kind === 'hosted'
        ? await this.createHosted(parsed, parsed.repository)
        : parsed.repository.kind === 'local'
          ? await this.createLocal(destination, parsed.repository.layout)
          : this.createFolder(destination);
    if (outcome.ok) {
      logger.info('NewProjectManager', `Created ${outcome.path}`);
    } else {
      logger.warn('NewProjectManager', `Project not created: ${outcome.error}`);
    }
    return outcome;
  }

  /**
   * Makes the project's folder, with no repository in it.
   * @param destination The folder to make.
   * @returns Returns the outcome.
   */
  private createFolder(destination: string): NewProjectOutcome {
    try {
      fs.mkdirSync(destination);
    } catch (error: unknown) {
      return { ok: false, error: `The folder could not be created: ${message(error)}` };
    }
    this.trusted.remember(destination);
    return { ok: true, path: destination };
  }

  /**
   * Has the version-control plugin make a repository on this machine: in the project's folder, or as
   * the first checkout of a worktree container there, which then has no origin. A failure removes the
   * folder it made, so a retry finds the name free.
   * @param destination The folder to make.
   * @param layout How the repository is laid out.
   * @returns Returns the outcome.
   */
  private async createLocal(destination: string, layout: CloneLayout): Promise<NewProjectOutcome> {
    const plugin: VersionControlDescriptor | null = this.versionControl.preferredPlugin();
    if (plugin === null) {
      return {
        ok: false,
        error: 'No version-control plugin is installed. Install Git from the Plugin Manager.',
      };
    }
    const id: string = mintCheckoutId();
    const repository: string = layout === 'worktree' ? path.join(destination, id) : destination;
    try {
      fs.mkdirSync(repository, { recursive: true });
    } catch (error: unknown) {
      return { ok: false, error: `The folder could not be created: ${message(error)}` };
    }
    const made: VersionControlResponse<'init'> = await this.versionControl.initInChosenFolder(
      plugin.id,
      { directory: repository },
    );
    if (!made.ok) {
      fs.rmSync(destination, { recursive: true, force: true });
      return { ok: false, error: made.error };
    }
    if (layout === 'worktree') {
      try {
        const studio: string = path.join(destination, STUDIO_DIR);
        fs.mkdirSync(studio, { recursive: true });
        fs.writeFileSync(
          path.join(studio, WORKTREE_CONFIG_FILE),
          serializeWorktreeConfig(defaultWorktreeConfig(null, [{ id }])),
          'utf8',
        );
      } catch (error: unknown) {
        return {
          ok: false,
          error: `The repository was made, but the container could not be set up: ${message(error)}`,
        };
      }
    }
    this.trusted.remember(destination);
    return { ok: true, path: destination };
  }

  /**
   * Has the code host make the repository, then clones it into the project's folder.
   * @param request The project.
   * @param repository Its hosted repository.
   * @returns Returns the outcome.
   */
  private async createHosted(
    request: NewProjectRequest,
    repository: Extract<NewProjectRequest['repository'], { kind: 'hosted' }>,
  ): Promise<NewProjectOutcome> {
    const made: ForgeResult<HostedRepository> = await this.hosting.createRepository(
      repository.host,
      repository.account,
      request.name,
      repository.private,
    );
    if (!made.ok) {
      return {
        ok: false,
        error: `${repository.host} could not make the repository: ${made.error}`,
      };
    }
    const cloned: CloneOutcome = await this.clones.clone({
      url: made.value.cloneUrl,
      name: request.name,
      layout: repository.layout,
    });
    return cloned.ok
      ? cloned
      : {
          ok: false,
          error: `The repository was made at ${made.value.webUrl}, but it could not be cloned: ${cloned.error}`,
        };
  }
}

/**
 * Validates a project request from the renderer, which is treated as hostile: the name must be one
 * plain folder name, a repository must name its layout, and a hosted one its host and account too.
 * @param value The untrusted request.
 * @returns Returns the request, or why it is refused.
 */
export function parseProjectRequest(value: unknown): NewProjectRequest | string {
  if (typeof value !== 'object' || value === null) {
    return 'No project was described.';
  }
  const { name, repository } = value as Record<string, unknown>;
  if (typeof name !== 'string' || !FOLDER_NAME.test(name)) {
    return 'The project name must be a single folder name, without slashes.';
  }
  if (typeof repository !== 'object' || repository === null) {
    return 'Choose a repository, or none.';
  }
  const fields: Record<string, unknown> = repository as Record<string, unknown>;
  if (fields['kind'] === 'none') {
    return { name, repository: { kind: 'none' } };
  }
  if (fields['kind'] === 'local') {
    const layout: unknown = fields['layout'];
    return layout === 'flat' || layout === 'worktree'
      ? { name, repository: { kind: 'local', layout } }
      : 'Choose a flat repository or a worktree.';
  }
  if (fields['kind'] !== 'hosted') {
    return 'Choose a repository, or none.';
  }
  const { host, account, layout } = fields;
  if (typeof host !== 'string' || host.length === 0 || typeof account !== 'string') {
    return 'Choose the account the repository is made under.';
  }
  if (layout !== 'flat' && layout !== 'worktree') {
    return 'Choose a flat repository or a worktree.';
  }
  return {
    name,
    repository: { kind: 'hosted', host, account, private: fields['private'] === true, layout },
  };
}

/**
 * The most bytes a text document may have to be attached inline: what a run accepts of one.
 */
const MAX_TEXT_BYTES: number = 200_000;

/**
 * The most bytes an image may have: what a run accepts of one, once base64-encoded.
 */
const MAX_IMAGE_BYTES: number = 4_400_000;

/**
 * The image types a run accepts, by extension.
 */
const IMAGE_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

/**
 * Reads the documents the user picked: an image as an image, anything else as text — unless it is too
 * large, or is not text at all, which is left out with why.
 * @param paths The absolute paths picked.
 * @returns Returns what was read and what was left out.
 */
export async function readDocuments(paths: readonly string[]): Promise<PickedDocuments> {
  const documents: ProjectDocument[] = [];
  const skipped: { name: string; reason: string }[] = [];
  for (const file of paths) {
    const name: string = path.basename(file);
    let bytes: Buffer;
    try {
      bytes = await fs.promises.readFile(file);
    } catch (error: unknown) {
      skipped.push({ name, reason: `It could not be read: ${message(error)}` });
      continue;
    }
    const mediaType: string | undefined = IMAGE_TYPES[path.extname(file).toLowerCase()];
    if (mediaType !== undefined) {
      if (bytes.length > MAX_IMAGE_BYTES) {
        skipped.push({ name, reason: 'Images over 4 MB cannot be attached.' });
      } else {
        documents.push({
          kind: 'image',
          name,
          path: file,
          mediaType,
          data: bytes.toString('base64'),
        });
      }
    } else if (bytes.includes(0)) {
      skipped.push({ name, reason: 'Only text documents and images can be attached.' });
    } else if (bytes.length > MAX_TEXT_BYTES) {
      skipped.push({ name, reason: 'Text documents over 200 KB cannot be attached.' });
    } else {
      documents.push({ kind: 'text', name, path: file, content: bytes.toString('utf8') });
    }
  }
  return { documents, skipped };
}

/**
 * Words an error for the user.
 * @param error The error.
 * @returns Returns its message.
 */
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
