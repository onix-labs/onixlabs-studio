import { BrowserWindow, ipcMain, IpcMainInvokeEvent, OpenDialogReturnValue, shell } from 'electron';
import { readPromptScope } from '@shared/api/ai-types';
import {
  SkillChannel,
  SKILL_FILE,
  type Skill,
  type SkillDraft,
  type SkillSaveResult,
} from '@shared/api/skill-channels';
import { showOpenDialog } from '@shared/electron/dialog-parent';
import { logger } from '@shared/electron/logger';
import { SkillLibrary } from './skill-library';

/**
 * The most characters a skill body may carry through IPC. Generous — a skill is a document, not a
 * sentence — but bounded, because the renderer is untrusted and an unbounded string is a way to fill
 * the disk from a compromised page.
 */
const BODY_LIMIT: number = 256 * 1024;

/**
 * Registers the skill library's IPC handlers (#301), validating everything the renderer sends before
 * the library sees it.
 */
export class SkillHandlers {
  /**
   * Initializes a new instance of the {@link SkillHandlers} class.
   * @param library The library the handlers operate on.
   * @param windowGetter Returns the main window, to parent the import dialog.
   */
  public constructor(
    private readonly library: SkillLibrary,
    private readonly windowGetter: () => BrowserWindow | null,
  ) {}

  /**
   * Registers the handlers.
   */
  public register(): void {
    logger.info('SkillHandlers', `Registering skill IPC handlers (${this.library.directory})`);
    ipcMain.handle(SkillChannel.List, (): Promise<readonly Skill[]> => this.library.list());
    ipcMain.handle(
      SkillChannel.Save,
      (_event: IpcMainInvokeEvent, value: unknown): Promise<SkillSaveResult> => {
        const draft: SkillDraft | null = this.readDraft(value);
        return draft === null
          ? Promise.resolve({ skill: null, error: 'The skill was malformed.' })
          : this.library.save(draft);
      },
    );
    ipcMain.handle(
      SkillChannel.Delete,
      (_event: IpcMainInvokeEvent, name: unknown): Promise<void> =>
        typeof name === 'string' ? this.library.delete(name) : Promise.resolve(),
    );
    ipcMain.handle(SkillChannel.Reveal, (_event: IpcMainInvokeEvent, name: unknown): void => {
      const directory: string | null =
        typeof name === 'string' ? this.library.folderOf(name) : null;
      if (directory !== null) {
        shell.showItemInFolder(directory);
      }
    });
    ipcMain.handle(SkillChannel.OpenLibrary, async (): Promise<void> => {
      // Opened rather than revealed: a library that does not exist yet is created first, so the user
      // lands in the folder they will put skills in rather than in an error.
      const { mkdir } = await import('node:fs/promises');
      await mkdir(this.library.directory, { recursive: true });
      const failure: string = await shell.openPath(this.library.directory);
      if (failure.length > 0) {
        logger.warn('SkillHandlers', `Could not open the skill library: ${failure}`);
      }
    });
    ipcMain.handle(
      SkillChannel.Import,
      async (event: IpcMainInvokeEvent): Promise<SkillSaveResult | null> => {
        const result: OpenDialogReturnValue = await showOpenDialog(
          event.sender,
          this.windowGetter,
          {
            title: 'Import a skill',
            message: `Choose a ${SKILL_FILE}, or a folder holding one.`,
            properties: ['openFile', 'openDirectory'],
            filters: [{ name: 'Skill', extensions: ['md'] }],
          },
        );
        if (result.canceled || result.filePaths.length === 0) {
          return null;
        }
        return this.library.import(result.filePaths[0]);
      },
    );
  }

  /**
   * Reads a draft out of untrusted input.
   * @param value The value the renderer sent.
   * @returns Returns the draft, or null when it is not one.
   */
  private readDraft(value: unknown): SkillDraft | null {
    if (value === null || typeof value !== 'object') {
      return null;
    }
    const record: Record<string, unknown> = value as Record<string, unknown>;
    if (
      typeof record['name'] !== 'string' ||
      typeof record['description'] !== 'string' ||
      typeof record['body'] !== 'string' ||
      record['body'].length > BODY_LIMIT
    ) {
      return null;
    }
    return {
      name: record['name'],
      ...(typeof record['previousName'] === 'string'
        ? { previousName: record['previousName'] }
        : {}),
      description: record['description'],
      scope: readPromptScope(record['scope']),
      enabled: record['enabled'] !== false,
      body: record['body'],
    };
  }
}
