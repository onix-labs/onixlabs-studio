import { BrowserWindow, ipcMain, IpcMainInvokeEvent, shell } from 'electron';
import { promises as fs } from 'node:fs';
import {
  PersonaChannel,
  type PersonaEntry,
  type PersonaListing,
} from '@shared/api/persona-channels';
import { logger } from '@shared/electron/logger';
import { readEntry, type PersonaLibrary } from './persona-library';

/**
 * Registers the IPC handlers of the persona store (#1514), validating everything the renderer sends
 * before the store sees it.
 */
export class PersonaHandlers {
  /**
   * Initializes a new instance of the {@link PersonaHandlers} class.
   * @param library The persona store.
   */
  public constructor(private readonly library: PersonaLibrary) {}

  /**
   * Registers the handlers.
   */
  public register(): void {
    logger.info('PersonaHandlers', `Registering persona IPC handlers (${this.library.directory})`);
    ipcMain.handle(PersonaChannel.List, (): Promise<PersonaListing> => this.library.list());
    ipcMain.handle(
      PersonaChannel.Save,
      async (event: IpcMainInvokeEvent, value: unknown): Promise<string | null> => {
        const entry: PersonaEntry | null = readEntry(value);
        if (entry === null) {
          return 'The entry was malformed.';
        }
        const error: string | null = await this.library.save(entry);
        if (error === null) {
          announcePersonaChange(event.sender.id);
        }
        return error;
      },
    );
    ipcMain.handle(
      PersonaChannel.Delete,
      async (event: IpcMainInvokeEvent, id: unknown): Promise<void> => {
        if (typeof id === 'string') {
          await this.library.delete(id);
          announcePersonaChange(event.sender.id);
        }
      },
    );
    ipcMain.handle(PersonaChannel.OpenFolder, async (): Promise<void> => {
      await fs.mkdir(this.library.entriesDirectory, { recursive: true });
      const failure: string = await shell.openPath(this.library.entriesDirectory);
      if (failure.length > 0) {
        logger.warn('PersonaHandlers', `Could not open the persona folder: ${failure}`);
      }
    });
  }
}

/**
 * Tells windows the persona changed, so each re-reads it.
 * @param except The web contents that made the change and already holds it, or null to tell every
 * window (a change made in the main process, by learning or an agent's tool).
 */
export function announcePersonaChange(except: number | null = null): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && window.webContents.id !== except) {
      window.webContents.send(PersonaChannel.Changed);
    }
  }
}
