import { BrowserWindow, ipcMain, IpcMainInvokeEvent, OpenDialogReturnValue, shell } from 'electron';
import { readPromptScope } from '@shared/api/ai-types';
import {
  PromptProfileChannel,
  type PromptProfile,
  type PromptProfileListing,
} from '@shared/api/prompt-profile-channels';
import { readSkillTechnologies } from '@shared/api/skill-channels';
import {
  SkillImportChannel,
  type SkillExportResult,
  type SkillImportAcceptedProfile,
  type SkillImportAcceptedSkill,
  type SkillImportCommit,
  type SkillImportDraft,
  type SkillImportPlan,
  type SkillImportResult,
} from '@shared/api/skill-import-channels';
import { showMessageBox, showOpenDialog } from '@shared/electron/dialog-parent';
import { logger } from '@shared/electron/logger';
import {
  PROFILE_INSTRUCTIONS_LIMIT,
  readProfile,
  type PromptProfileLibrary,
} from '../prompt-profiles/prompt-profile-library';
import type { LibraryTransfer } from './library-transfer';

/**
 * The most characters an accepted skill body may carry through IPC, matching a skill save's bound.
 */
const BODY_LIMIT: number = 256 * 1024;

/**
 * The most skills one commit may carry.
 */
const COMMIT_LIMIT: number = 2_000;

/**
 * Registers the IPC handlers of the prompt-profile library and of import and export (#1263),
 * validating everything the renderer sends before the libraries see it.
 */
export class LibraryTransferHandlers {
  /**
   * Initializes a new instance of the {@link LibraryTransferHandlers} class.
   * @param profiles The prompt-profile library.
   * @param transfer The import and export engine.
   * @param windowGetter Returns the main window, to parent the dialogs.
   */
  public constructor(
    private readonly profiles: PromptProfileLibrary,
    private readonly transfer: LibraryTransfer,
    private readonly windowGetter: () => BrowserWindow | null,
  ) {}

  /**
   * Registers the handlers.
   */
  public register(): void {
    logger.info(
      'LibraryTransferHandlers',
      `Registering profile and import IPC handlers (${this.profiles.directory})`,
    );
    ipcMain.handle(PromptProfileChannel.List, (): Promise<PromptProfileListing> =>
      this.profiles.list(),
    );
    ipcMain.handle(
      PromptProfileChannel.Save,
      async (event: IpcMainInvokeEvent, value: unknown): Promise<string | null> => {
        const profile: PromptProfile | null = readProfile(value, readPromptScope);
        if (profile === null) {
          return 'The profile was malformed.';
        }
        const error: string | null = await this.profiles.save(profile);
        if (error === null) {
          this.announce(event);
        }
        return error;
      },
    );
    ipcMain.handle(
      PromptProfileChannel.Delete,
      async (event: IpcMainInvokeEvent, id: unknown): Promise<void> => {
        if (typeof id === 'string') {
          await this.profiles.delete(id);
          this.announce(event);
        }
      },
    );
    ipcMain.handle(
      SkillImportChannel.Choose,
      async (event: IpcMainInvokeEvent): Promise<SkillImportPlan | null> => {
        const result: OpenDialogReturnValue = await showOpenDialog(
          event.sender,
          this.windowGetter,
          {
            title: 'Import Skills',
            message:
              'Choose Markdown files, a folder of them, a Studio export, or a skill folder. Pick several to import them together.',
            buttonLabel: 'Import',
            properties: ['openFile', 'openDirectory', 'multiSelections'],
            filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
          },
        );
        if (result.canceled || result.filePaths.length === 0) {
          return null;
        }
        return this.transfer.scan(result.filePaths);
      },
    );
    ipcMain.handle(
      SkillImportChannel.ChooseProfiles,
      async (event: IpcMainInvokeEvent): Promise<SkillImportPlan | null> => {
        const result: OpenDialogReturnValue = await showOpenDialog(
          event.sender,
          this.windowGetter,
          {
            title: 'Import Prompt Profiles',
            message:
              'Choose Markdown files, a folder of them, or a Studio export. Each file becomes a profile.',
            buttonLabel: 'Import',
            properties: ['openFile', 'openDirectory', 'multiSelections'],
            filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
          },
        );
        if (result.canceled || result.filePaths.length === 0) {
          return null;
        }
        return this.transfer.scanForProfiles(result.filePaths);
      },
    );
    ipcMain.handle(PromptProfileChannel.OpenFolder, async (): Promise<void> => {
      const { mkdir } = await import('node:fs/promises');
      await mkdir(this.profiles.directory, { recursive: true });
      const failure: string = await shell.openPath(this.profiles.directory);
      if (failure.length > 0) {
        logger.warn('LibraryTransferHandlers', `Could not open the profile folder: ${failure}`);
      }
    });
    ipcMain.handle(SkillImportChannel.Discard, (_event: IpcMainInvokeEvent, id: unknown): void => {
      if (typeof id === 'string') {
        this.transfer.discard(id);
      }
    });
    ipcMain.handle(
      SkillImportChannel.Commit,
      async (event: IpcMainInvokeEvent, value: unknown): Promise<SkillImportResult> => {
        const commit: SkillImportCommit | null = this.readCommit(value);
        if (commit === null) {
          return { skills: 0, profiles: 0, linksRewritten: 0, error: 'The import was malformed.' };
        }
        const result: SkillImportResult = await this.transfer.commit(commit);
        if (result.error === null && result.profiles > 0) {
          this.announce(event, true);
        }
        return result;
      },
    );
    ipcMain.handle(
      SkillImportChannel.Export,
      async (event: IpcMainInvokeEvent): Promise<SkillExportResult | null> => {
        const result: OpenDialogReturnValue = await showOpenDialog(
          event.sender,
          this.windowGetter,
          {
            title: 'Export AI Library',
            message: 'Choose where to save a copy of your skills and prompt profiles.',
            buttonLabel: 'Export',
            properties: ['openDirectory', 'createDirectory'],
          },
        );
        if (result.canceled || result.filePaths.length === 0) {
          return null;
        }
        const exported: SkillExportResult = await this.transfer.export(result.filePaths[0]);
        // The export answers for itself — the new folder revealed, or why there is none — so any
        // view can offer it without a place of its own to report the outcome.
        if (exported.folder !== null) {
          shell.showItemInFolder(exported.folder);
        } else {
          await showMessageBox(event.sender, this.windowGetter, {
            type: 'error',
            message: 'The AI library could not be exported',
            detail: exported.error ?? undefined,
          });
        }
        return exported;
      },
    );
  }

  /**
   * Tells every other window the profiles changed, so each re-reads them; the window that made the
   * change already holds it.
   * @param event The request that changed them.
   * @param everyone Whether the sender is told too (an import changed them behind its back).
   */
  private announce(event: IpcMainInvokeEvent, everyone: boolean = false): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && (everyone || window.webContents.id !== event.sender.id)) {
        window.webContents.send(PromptProfileChannel.Changed);
      }
    }
  }

  /**
   * Reads a commit out of untrusted input.
   * @param value The value the renderer sent.
   * @returns Returns the commit, or null when it is not one.
   */
  private readCommit(value: unknown): SkillImportCommit | null {
    if (value === null || typeof value !== 'object') {
      return null;
    }
    const record: Record<string, unknown> = value as Record<string, unknown>;
    if (
      typeof record['planId'] !== 'string' ||
      !Array.isArray(record['skills']) ||
      !Array.isArray(record['profiles']) ||
      record['skills'].length > COMMIT_LIMIT ||
      record['profiles'].length > COMMIT_LIMIT
    ) {
      return null;
    }
    const skills: SkillImportAcceptedSkill[] = [];
    for (const item of record['skills'] as unknown[]) {
      const accepted: SkillImportAcceptedSkill | null = this.readAcceptedSkill(item);
      if (accepted === null) {
        return null;
      }
      skills.push(accepted);
    }
    const profiles: SkillImportAcceptedProfile[] = [];
    for (const item of record['profiles'] as unknown[]) {
      const entry: Record<string, unknown> | null =
        item !== null && typeof item === 'object' ? (item as Record<string, unknown>) : null;
      const profile: PromptProfile | null =
        entry === null ? null : readProfile(entry['profile'], readPromptScope);
      if (entry === null || profile === null) {
        return null;
      }
      profiles.push({ profile, replace: entry['replace'] === true });
    }
    return { planId: record['planId'], skills, profiles };
  }

  /**
   * Reads one accepted skill out of untrusted input.
   * @param value The value.
   * @returns Returns the accepted skill, or null when it is not one.
   */
  private readAcceptedSkill(value: unknown): SkillImportAcceptedSkill | null {
    if (value === null || typeof value !== 'object') {
      return null;
    }
    const record: Record<string, unknown> = value as Record<string, unknown>;
    const draft: unknown = record['draft'];
    if (typeof record['source'] !== 'string' || draft === null || typeof draft !== 'object') {
      return null;
    }
    const fields: Record<string, unknown> = draft as Record<string, unknown>;
    if (
      typeof fields['name'] !== 'string' ||
      typeof fields['description'] !== 'string' ||
      typeof fields['body'] !== 'string' ||
      fields['body'].length > BODY_LIMIT ||
      fields['description'].length > PROFILE_INSTRUCTIONS_LIMIT
    ) {
      return null;
    }
    const parsed: SkillImportDraft = {
      name: fields['name'].trim().toLowerCase(),
      description: fields['description'].trim(),
      scope: readPromptScope(fields['scope']),
      technologies: readSkillTechnologies(fields['technologies']),
      enabled: fields['enabled'] !== false,
      body: fields['body'],
    };
    return { source: record['source'], draft: parsed, replace: record['replace'] === true };
  }
}
