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
   * Reads a window of raw bytes from a file, for the binary/hex editor (invoke). Honoured only for
   * trusted paths or files within an open workspace.
   */
  ReadBytes = 'workspace:read-bytes',

  /**
   * Writes in-place byte patches to a file, for saving binary/hex edits (invoke). Honoured only for
   * trusted paths or files within an open workspace. Overwrites bytes at fixed offsets; it never
   * changes the file's length.
   */
  WriteBytes = 'workspace:write-bytes',

  /**
   * Rewrites a file from a list of spans, for saving binary/hex edits that insert or delete bytes
   * (invoke). Honoured only for trusted paths or files within an open workspace. The file is streamed
   * to a temporary file and atomically renamed, so its length may change.
   */
  WritePieces = 'workspace:write-pieces',

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

  /**
   * Gets whether a successful delete moved the entry to the operating system's trash, rather than
   * removing it permanently.
   *
   * Reported rather than assumed, because trashing is the recoverable path and the caller's copy has
   * to be honest about which one happened: a confirmation that promises the Trash, in front of an
   * operation that fell back to a permanent removal, is a lie the user only discovers afterwards.
   * Undefined for operations that delete nothing.
   */
  readonly trashed?: boolean;
}

/**
 * Describes a window of raw bytes read from a file for the binary/hex editor, together with the total
 * file size so the renderer can size its virtual scroll without loading the whole file.
 */
export interface BinaryChunk {
  /**
   * Gets the total size of the file, in bytes.
   */
  readonly size: number;

  /**
   * Gets the absolute offset of the first returned byte. Clamped to the file size, so it may be less
   * than the requested offset when the request began past the end of the file.
   */
  readonly offset: number;

  /**
   * Gets the bytes read. Its length may be shorter than requested when the window meets the end of the
   * file (and empty when the offset is at or past the end).
   */
  readonly bytes: Uint8Array;
}

/**
 * Describes a single in-place byte patch: a run of bytes to overwrite at a fixed file offset. Used to
 * save binary/hex edits without rewriting the whole file.
 */
export interface BinaryPatch {
  /**
   * Gets the absolute file offset the run overwrites.
   */
  readonly offset: number;

  /**
   * Gets the byte values (0–255) to write at the offset.
   */
  readonly bytes: readonly number[];
}

/**
 * Describes one span of a rewritten binary file: a run of bytes taken either from the original file on
 * disk (`original`, `start` is a file offset) or from the accompanying added buffer (`added`, `start`
 * is an index into it). Used to stream-rewrite a file when a binary/hex edit changes its length.
 */
export interface BinarySpan {
  /**
   * Gets which buffer the span's bytes come from.
   */
  readonly source: 'original' | 'added';

  /**
   * Gets the span's start offset within its source buffer.
   */
  readonly start: number;

  /**
   * Gets the span's length in bytes.
   */
  readonly length: number;
}

/**
 * Describes the outcome of a combined open request: a directory to open as the workspace, a text
 * file to open in an editor, or a binary file that is recognised but not opened as text.
 */
export type OpenSelection =
  | { readonly kind: 'directory'; readonly directory: DirectoryListing }
  | { readonly kind: 'file'; readonly file: FileInfo }
  | { readonly kind: 'binary'; readonly path: string };
