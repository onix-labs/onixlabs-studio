import type { FileInfo } from './file-channels';

/**
 * Names the workspace (open-folder) and directory IPC channels, and the types their payloads carry.
 * This is the workspace capability's slice of the IPC contract: the shared workspace client and the
 * main-process workspace manager name their channels from here, over the generic
 * {@link import('./bridge').Bridge} transport. All path-taking operations are confined to the open
 * workspace root in the main process before any disk access, so the renderer cannot read or write
 * arbitrary locations.
 */
export enum WorkspaceChannel {
  /**
   * Shows a combined open dialog allowing either a file or a folder to be chosen (invoke).
   */
  Open = 'workspace:open',

  /**
   * Reads a single file within the workspace for opening in an editor (invoke).
   */
  OpenFile = 'workspace:open-file',

  /**
   * Shows an open-folder dialog and sets the chosen folder as the workspace root (invoke).
   */
  OpenFolder = 'workspace:open-folder',

  /**
   * Closes an open workspace folder (invoke).
   */
  CloseFolder = 'workspace:close-folder',

  /**
   * Reads the immediate children of a directory within the workspace (invoke).
   */
  ReadDirectory = 'workspace:read-directory',

  /**
   * Re-opens a previously user-opened folder by path as a workspace root; honoured only for paths the
   * user has opened through a dialog before (invoke).
   */
  ReopenFolder = 'workspace:reopen-folder',

  /**
   * Re-opens a previously user-opened file by path; honoured only for trusted paths or files within an
   * open workspace (invoke).
   */
  ReopenFile = 'workspace:reopen-file',

  /**
   * Creates an empty file inside a workspace directory (invoke).
   */
  CreateFile = 'workspace:create-file',

  /**
   * Creates an empty folder inside a workspace directory (invoke).
   */
  CreateFolder = 'workspace:create-folder',

  /**
   * Renames a file or folder within the workspace (invoke).
   */
  Rename = 'workspace:rename',

  /**
   * Deletes a file or folder within the workspace (invoke).
   */
  Delete = 'workspace:delete',
}

/**
 * Identifies whether a directory entry is a file or a directory.
 */
export type DirectoryEntryType = 'file' | 'directory';

/**
 * Describes a single immediate child of a directory.
 */
export interface DirectoryEntry {
  /**
   * Gets the entry's base name (for example, `main.ts`).
   */
  readonly name: string;

  /**
   * Gets the entry's absolute path.
   */
  readonly path: string;

  /**
   * Gets whether the entry is a file or a directory.
   */
  readonly type: DirectoryEntryType;
}

/**
 * Describes a shallow listing of a directory's immediate children.
 */
export interface DirectoryListing {
  /**
   * Gets the directory's absolute path.
   */
  readonly path: string;

  /**
   * Gets the directory's base name.
   */
  readonly name: string;

  /**
   * Gets the directory's immediate children, ordered directories-first then by name.
   */
  readonly entries: readonly DirectoryEntry[];
}

/**
 * Describes the result of a workspace mutation (create, rename, or delete).
 */
export interface FileOperationResult {
  /**
   * Gets a value indicating whether the operation succeeded.
   */
  readonly success: boolean;

  /**
   * Gets the absolute path the operation produced, when successful.
   */
  readonly path?: string;

  /**
   * Gets the error message, when the operation failed.
   */
  readonly error?: string;
}

/**
 * Describes the outcome of a combined open request: a directory to open as the workspace, a text
 * file to open in an editor, or a binary file that is recognised but not opened as text.
 */
export type OpenSelection =
  | { readonly kind: 'directory'; readonly directory: DirectoryListing }
  | { readonly kind: 'file'; readonly file: FileInfo }
  | { readonly kind: 'binary'; readonly path: string };
