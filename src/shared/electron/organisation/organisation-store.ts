import type { IpcMainInvokeEvent } from 'electron';
import {
  Organisation,
  ORGANISATION_FILE,
  ORGANISATION_USER_FILE,
  OrganisationUser,
  parseOrganisation,
  parseOrganisationUser,
  serializeOrganisation,
  serializeOrganisationUser,
} from '@shared/api/organisation';
import { OrganisationChannel, OrganisationSnapshot } from '@shared/api/organisation-channels';
import { logger } from '../logger';
import { readStudioJson, writeStudioFile } from '../studio/studio-files';

/**
 * The slice of `ipcMain` the store registers through, so it can be exercised without Electron.
 */
export interface OrganisationIpc {
  /**
   * Registers an invoke handler.
   * @param channel The channel.
   * @param handler The handler.
   */
  handle(
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
  ): void;
}

/**
 * Reads and writes a project's organisation files (`.studio/organisation.json` and
 * `.studio/organisation.user.json`) on behalf of the renderer (epic #788).
 *
 * Confined to open workspace roots, as the studio store is, so the renderer cannot reach a `.studio`
 * folder outside the workspaces the user opened. Every payload is parsed before it is written — the
 * renderer is untrusted — and what was actually written is returned, so the caller holds the sanitised
 * copy rather than its own.
 */
export class OrganisationStore {
  /**
   * Holds the test that a path is an open workspace root.
   */
  private readonly isRoot: (root: string) => boolean;

  /**
   * Initializes a new instance of the {@link OrganisationStore} class.
   * @param isRoot Tells whether a path is an open workspace root.
   */
  public constructor(isRoot: (root: string) => boolean) {
    this.isRoot = isRoot;
  }

  /**
   * Registers the organisation IPC handlers.
   * @param ipc Where to register them.
   */
  public register(ipc: OrganisationIpc): void {
    logger.info('OrganisationStore', 'Registering organisation IPC handlers');
    ipc.handle(
      OrganisationChannel.Load,
      (_event: IpcMainInvokeEvent, root: unknown): Promise<OrganisationSnapshot | null> =>
        this.load(root),
    );
    ipc.handle(
      OrganisationChannel.Save,
      (_event: IpcMainInvokeEvent, root: unknown, payload: unknown): Promise<Organisation | null> =>
        this.save(root, payload),
    );
    ipc.handle(
      OrganisationChannel.SaveUser,
      (
        _event: IpcMainInvokeEvent,
        root: unknown,
        payload: unknown,
      ): Promise<OrganisationUser | null> => this.saveUser(root, payload),
    );
  }

  /**
   * Reads a project's organisation, each file defaulting when absent or malformed.
   * @param root The candidate workspace root.
   * @returns Returns the snapshot, or null when the root is not open.
   */
  public async load(root: unknown): Promise<OrganisationSnapshot | null> {
    if (!this.confined(root, 'load')) {
      return null;
    }
    const [organisation, user]: [unknown, unknown] = await Promise.all([
      readStudioJson(root, ORGANISATION_FILE),
      readStudioJson(root, ORGANISATION_USER_FILE),
    ]);
    return { organisation: parseOrganisation(organisation), user: parseOrganisationUser(user) };
  }

  /**
   * Writes a project's committed organisation.
   * @param root The candidate workspace root.
   * @param payload The candidate organisation, never trusted.
   * @returns Returns the organisation as written, or null when the root is not open.
   */
  public async save(root: unknown, payload: unknown): Promise<Organisation | null> {
    if (!this.confined(root, 'save')) {
      return null;
    }
    const contents: string = serializeOrganisation(parseOrganisation(payload));
    await writeStudioFile(root, ORGANISATION_FILE, contents);
    logger.info('OrganisationStore.save', `Saved ${ORGANISATION_FILE} for ${root}`);
    return parseOrganisation(JSON.parse(contents));
  }

  /**
   * Writes a project's per-developer organisation state.
   * @param root The candidate workspace root.
   * @param payload The candidate state, never trusted.
   * @returns Returns the state as written, or null when the root is not open.
   */
  public async saveUser(root: unknown, payload: unknown): Promise<OrganisationUser | null> {
    if (!this.confined(root, 'saveUser')) {
      return null;
    }
    const user: OrganisationUser = parseOrganisationUser(payload);
    await writeStudioFile(root, ORGANISATION_USER_FILE, serializeOrganisationUser(user));
    logger.debug('OrganisationStore.saveUser', `Saved ${ORGANISATION_USER_FILE} for ${root}`);
    return user;
  }

  /**
   * Tells whether a root is an open workspace, logging a refusal.
   * @param root The candidate root.
   * @param operation The operation asking, for the log.
   * @returns Returns true when the operation may proceed.
   */
  private confined(root: unknown, operation: string): root is string {
    if (typeof root === 'string' && this.isRoot(root)) {
      return true;
    }
    logger.warn(`OrganisationStore.${operation}`, `Rejected non-open root ${String(root)}`);
    return false;
  }
}
