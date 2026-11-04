import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { readFile, stat } from 'node:fs/promises';
import {
  EditorConfigChannel,
  EditorConfigResolution,
  NO_EDITOR_CONFIG,
} from '@shared/api/editor-config-channels';
import { logger } from '../logger';
import { resolveEditorConfig } from './editor-config-resolver';

/**
 * Holds the largest `.editorconfig` read. They arrive with cloned repositories, and a real one is a
 * few hundred bytes.
 */
const MAX_FILE_SIZE: number = 64 * 1024;

/**
 * Reads an `.editorconfig`.
 * @param filePath The path.
 * @returns Returns its text, or null when it is missing, unreadable or implausibly large.
 */
async function readEditorConfig(filePath: string): Promise<string | null> {
  try {
    if ((await stat(filePath)).size > MAX_FILE_SIZE) {
      logger.warn('EditorConfigManager', `Ignoring oversized ${filePath}`);
      return null;
    }
    return await readFile(filePath, 'utf8');
  } catch {
    // Most folders have none, so this is the ordinary answer rather than a failure.
    return null;
  }
}

/**
 * Answers the renderer's EditorConfig questions: walking a file's folders is file-system work, and
 * generic to every language, so it lives here rather than in a plugin.
 */
export class EditorConfigManager {
  /**
   * Registers the EditorConfig IPC handlers.
   */
  public register(): void {
    logger.info('EditorConfigManager', 'Registering EditorConfig IPC handlers');
    ipcMain.handle(
      EditorConfigChannel.Resolve,
      (_event: IpcMainInvokeEvent, filePath: unknown): Promise<EditorConfigResolution> =>
        typeof filePath === 'string' && filePath.length > 0
          ? resolveEditorConfig(filePath, readEditorConfig)
          : Promise.resolve(NO_EDITOR_CONFIG),
    );
  }
}
