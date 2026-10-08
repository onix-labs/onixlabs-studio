// Creating a new project from the welcome screen (#806): the IPC channel and the renderer-facing client.
//
// A new project's folder is made in the parent folder clones go into — the one the user chose in the
// main process's own dialog — so, as with a clone, the renderer names the folder but never where it is.
// With a hosted repository the code host makes it first and the project is a clone of it; with a local
// one the version-control plugin makes it in place; with none, the folder is simply made.

import type { CloneLayout } from './clone-channels';

/**
 * The new-project IPC channels.
 */
export enum NewProjectChannel {
  /**
   * Creates a new project's folder in the chosen parent folder (invoke).
   */
  Create = 'new-project:create',

  /**
   * Asks the user for supporting documents in the main process's own dialog, and reads them to attach
   * to the agent's first message (invoke).
   */
  PickDocuments = 'new-project:pick-documents',
}

/**
 * A supporting document read for a new project's first message: a text document's content, or an
 * image's data. Read here rather than referred to by path, so the agent can read it wherever it is —
 * even before the project has a folder the agent may look in.
 */
export type ProjectDocument =
  | {
      /**
       * Gets that it is text, attached inline.
       */
      readonly kind: 'text';

      /**
       * Gets the file's name.
       */
      readonly name: string;

      /**
       * Gets the file's absolute path, for the agent's reference.
       */
      readonly path: string;

      /**
       * Gets its content.
       */
      readonly content: string;
    }
  | {
      /**
       * Gets that it is an image, attached as one.
       */
      readonly kind: 'image';

      /**
       * Gets the file's name.
       */
      readonly name: string;

      /**
       * Gets the file's absolute path, for the agent's reference.
       */
      readonly path: string;

      /**
       * Gets its media type, e.g. "image/png".
       */
      readonly mediaType: string;

      /**
       * Gets its bytes, base64-encoded.
       */
      readonly data: string;
    };

/**
 * Describes the documents the user picked: those read, and those that could not be attached and why.
 */
export interface PickedDocuments {
  /**
   * Gets the documents read.
   */
  readonly documents: readonly ProjectDocument[];

  /**
   * Gets the files left out, each with why, worded for the user.
   */
  readonly skipped: readonly { readonly name: string; readonly reason: string }[];
}

/**
 * Describes the repository a new project starts with: none; one on this machine only; or one a code
 * host makes, public or private, under one of the user's accounts there.
 */
export type NewProjectRepository =
  | {
      /**
       * Gets that the project has no repository.
       */
      readonly kind: 'none';
    }
  | {
      /**
       * Gets that the version-control plugin makes the repository, on this machine only.
       */
      readonly kind: 'local';

      /**
       * Gets how it is laid out.
       */
      readonly layout: CloneLayout;
    }
  | {
      /**
       * Gets that the code host makes the repository.
       */
      readonly kind: 'hosted';

      /**
       * Gets the code host, e.g. "github.com".
       */
      readonly host: string;

      /**
       * Gets the account it is made under: the user's own login, or an organisation's.
       */
      readonly account: string;

      /**
       * Gets whether only those given access can see it.
       */
      readonly private: boolean;

      /**
       * Gets how its clone is laid out.
       */
      readonly layout: CloneLayout;
    };

/**
 * Describes a project to create.
 */
export interface NewProjectRequest {
  /**
   * Gets the project's name: its folder's, and its repository's when it has one.
   */
  readonly name: string;

  /**
   * Gets the repository it starts with.
   */
  readonly repository: NewProjectRepository;
}

/**
 * Describes how creating a project went: where it is, or why there is none.
 */
export type NewProjectOutcome =
  | {
      /**
       * Gets that the project was made.
       */
      readonly ok: true;

      /**
       * Gets the absolute path of the folder to open.
       */
      readonly path: string;
    }
  | {
      /**
       * Gets that the project was not made.
       */
      readonly ok: false;

      /**
       * Gets why, worded for the user.
       */
      readonly error: string;
    };

/**
 * Defines the renderer-facing new-project operations, each mapping to a {@link NewProjectChannel}.
 */
export interface NewProjectClient {
  /**
   * Creates a new project's folder in the chosen parent folder.
   * @param request The project to make.
   * @returns Returns where it is, or why there is none.
   */
  create(request: NewProjectRequest): Promise<NewProjectOutcome>;

  /**
   * Asks the user for supporting documents and reads them.
   * @returns Returns what was read and what was left out; nothing when the dialog was cancelled.
   */
  pickDocuments(): Promise<PickedDocuments>;
}
