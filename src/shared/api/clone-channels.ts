// Cloning a repository into a new folder (#805): the IPC channels and the renderer-facing client.
//
// A clone's destination is not an open workspace yet, so it cannot be confined to one the way every
// other version-control request is. It is confined to a folder the user chose instead — in the main
// process's own folder dialog, which the renderer cannot answer for it — and remembered there, so the
// renderer can read it and ask to change it, but never name it.

/**
 * The cloning IPC channels.
 */
export enum CloneChannel {
  /**
   * Gets the folder clones go into, or null when none is chosen (invoke).
   */
  Parent = 'clone:parent',

  /**
   * Asks the user to choose the folder clones go into, in the main process's own dialog (invoke).
   */
  PickParent = 'clone:pick-parent',

  /**
   * Clones a repository into the chosen folder (invoke).
   */
  Clone = 'clone:clone',
}

/**
 * Names how a clone is laid out on disk: a plain repository, or a worktree container ready for several
 * branches at once, holding the clone as its first checkout.
 */
export type CloneLayout = 'flat' | 'worktree';

/**
 * Describes a clone to make.
 */
export interface CloneRequest {
  /**
   * Gets the URL to clone from.
   */
  readonly url: string;

  /**
   * Gets the name of the folder to create in the chosen parent folder.
   */
  readonly name: string;

  /**
   * Gets how the clone is laid out.
   */
  readonly layout: CloneLayout;

  /**
   * Gets the branch to check out, or undefined for the repository's default.
   */
  readonly branch?: string;
}

/**
 * Describes how a clone went: where the result is, or why there is none.
 */
export type CloneOutcome =
  | {
      /**
       * Gets that the clone was made.
       */
      readonly ok: true;

      /**
       * Gets the absolute path of the folder to open: the repository, or the worktree container.
       */
      readonly path: string;
    }
  | {
      /**
       * Gets that the clone was not made.
       */
      readonly ok: false;

      /**
       * Gets why, worded for the user.
       */
      readonly error: string;
    };

/**
 * Defines the renderer-facing cloning operations, each mapping to a {@link CloneChannel}.
 */
export interface CloneClient {
  /**
   * Gets the folder clones go into.
   * @returns Returns its absolute path, or null when none is chosen or it no longer exists.
   */
  parent(): Promise<string | null>;

  /**
   * Asks the user to choose the folder clones go into.
   * @returns Returns the chosen folder, or null when the dialog was cancelled.
   */
  pickParent(): Promise<string | null>;

  /**
   * Clones a repository into the chosen folder.
   * @param request The clone to make.
   * @returns Returns where the result is, or why there is none.
   */
  clone(request: CloneRequest): Promise<CloneOutcome>;
}
