import { Service } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import { Organisation, OrganisationUser } from '@shared/api/organisation';
import {
  OrganisationChannel,
  OrganisationClient,
  OrganisationSnapshot,
} from '@shared/api/organisation-channels';

/**
 * The renderer client for a project's organisation files (epic #788): a thin, typed wrapper over the
 * generic {@link Bridge} naming the {@link OrganisationChannel} channels. Outside Electron every call
 * answers as though the root were not open — there is nothing to read or write.
 */
@Service()
export class OrganisationFiles implements OrganisationClient {
  /**
   * Holds the IPC transport, or undefined when running outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Reads a project's organisation.
   * @param root The project's workspace root.
   * @returns Returns the snapshot, or null when the root is not an open workspace.
   */
  public load(root: string): Promise<OrganisationSnapshot | null> {
    return (
      this.bridge?.invoke<OrganisationSnapshot | null>(OrganisationChannel.Load, root) ??
      Promise.resolve(null)
    );
  }

  /**
   * Writes a project's committed organisation.
   * @param root The project's workspace root.
   * @param organisation The organisation to write.
   * @returns Returns the organisation as written, or null when the root is not an open workspace.
   */
  public save(root: string, organisation: Organisation): Promise<Organisation | null> {
    return (
      this.bridge?.invoke<Organisation | null>(OrganisationChannel.Save, root, organisation) ??
      Promise.resolve(null)
    );
  }

  /**
   * Writes a project's per-developer organisation state.
   * @param root The project's workspace root.
   * @param user The state to write.
   * @returns Returns the state as written, or null when the root is not an open workspace.
   */
  public saveUser(root: string, user: OrganisationUser): Promise<OrganisationUser | null> {
    return (
      this.bridge?.invoke<OrganisationUser | null>(OrganisationChannel.SaveUser, root, user) ??
      Promise.resolve(null)
    );
  }
}
