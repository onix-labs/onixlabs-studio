import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { IpcChannel } from '../shared/ipc-channels';
import { TempFileResult } from '../shared/studio-api';

/**
 * Holds the base name (without extension) given to every run file.
 */
const RUN_FILE_BASENAME: string = 'run';

/**
 * Holds the pattern of characters disallowed in a temp-file key, replaced with an underscore.
 */
const UNSAFE_KEY_CHARS: RegExp = /[^a-zA-Z0-9-]/g;

/**
 * Holds the pattern of characters disallowed in a file extension; stripped so the extension cannot
 * introduce path separators or traversal.
 */
const UNSAFE_EXTENSION_CHARS: RegExp = /[^a-zA-Z0-9]/g;

/**
 * Writes editor content to temporary files so the renderer's language runners can execute it.
 *
 * Each run key (the owning tab's id) gets a stable file inside a per-session directory, so repeated
 * runs reuse the same path (enabling tool build caches). The session directory is removed on
 * application shutdown.
 */
export class CodeRunner {
  /**
   * Holds the per-session directory that all run files are written under.
   */
  private readonly sessionDirectory: string = path.join(
    os.tmpdir(),
    'onixlabs-studio',
    `session-${randomUUID()}`,
  );

  /**
   * Registers the code-runner IPC handlers.
   */
  public register(): void {
    ipcMain.handle(
      IpcChannel.RunWriteTempFile,
      (
        _event: IpcMainInvokeEvent,
        key: unknown,
        extension: unknown,
        content: unknown,
      ): Promise<TempFileResult> => this.writeTempFile(key, extension, content),
    );
  }

  /**
   * Removes the session directory. Called on application shutdown.
   */
  public dispose(): void {
    try {
      rmSync(this.sessionDirectory, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup on shutdown; ignore failures.
    }
  }

  /**
   * Writes content to the stable run file for a key, after validating the arguments.
   * @param key The run key (the owning tab's id).
   * @param extension The file extension to use.
   * @param content The content to write.
   * @returns Returns the result describing success and the file path.
   */
  private async writeTempFile(
    key: unknown,
    extension: unknown,
    content: unknown,
  ): Promise<TempFileResult> {
    if (typeof key !== 'string' || typeof extension !== 'string' || typeof content !== 'string') {
      return { success: false, error: 'Invalid run arguments' };
    }
    try {
      const safeKey: string = key.replace(UNSAFE_KEY_CHARS, '_') || 'default';
      const cleanedExtension: string = extension
        .replace(/^\.+/, '')
        .replace(UNSAFE_EXTENSION_CHARS, '');
      const safeExtension: string = cleanedExtension.length > 0 ? `.${cleanedExtension}` : '';
      const directory: string = path.join(this.sessionDirectory, safeKey);
      await fs.mkdir(directory, { recursive: true });
      const filePath: string = path.join(directory, `${RUN_FILE_BASENAME}${safeExtension}`);
      await fs.writeFile(filePath, content, 'utf-8');
      return { success: true, path: filePath };
    } catch (error: unknown) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
}
