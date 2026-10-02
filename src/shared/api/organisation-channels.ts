// The agent organisation's slice of the IPC contract (epic #788): reading and writing a project's
// roster and per-developer organisation state. Every operation is confined in main to an open
// workspace root, and every payload is parsed there before it is written.

import { Organisation, OrganisationUser } from './organisation';

/**
 * Names the organisation IPC channels. Every operation is a request/response `invoke`.
 */
export enum OrganisationChannel {
  /**
   * Reads a project's organisation, both files, or null when the root is not an open workspace
   * (invoke).
   */
  Load = 'organisation:load',

  /**
   * Writes a project's committed organisation and returns what was written, or null when the root is
   * not an open workspace (invoke).
   */
  Save = 'organisation:save',

  /**
   * Writes a project's per-developer organisation state and returns what was written, or null when
   * the root is not an open workspace (invoke).
   */
  SaveUser = 'organisation:save-user',
}

/**
 * A project's organisation as read: the committed roster and the per-developer state.
 */
export interface OrganisationSnapshot {
  /**
   * Gets the committed part.
   */
  readonly organisation: Organisation;

  /**
   * Gets the per-developer part.
   */
  readonly user: OrganisationUser;
}

/**
 * Defines the renderer-facing organisation operations, each mapping to an {@link OrganisationChannel}.
 */
export interface OrganisationClient {
  /**
   * Reads a project's organisation.
   * @param root The project's workspace root.
   * @returns Returns the snapshot, or null when the root is not an open workspace.
   */
  load(root: string): Promise<OrganisationSnapshot | null>;

  /**
   * Writes a project's committed organisation.
   * @param root The project's workspace root.
   * @param organisation The organisation to write.
   * @returns Returns the organisation as written, or null when the root is not an open workspace.
   */
  save(root: string, organisation: Organisation): Promise<Organisation | null>;

  /**
   * Writes a project's per-developer organisation state.
   * @param root The project's workspace root.
   * @param user The state to write.
   * @returns Returns the state as written, or null when the root is not an open workspace.
   */
  saveUser(root: string, user: OrganisationUser): Promise<OrganisationUser | null>;
}
