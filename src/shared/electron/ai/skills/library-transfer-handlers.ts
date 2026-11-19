import { BrowserWindow, ipcMain, IpcMainInvokeEvent, OpenDialogReturnValue, shell } from 'electron';
import { readPromptScope } from '@shared/api/ai-types';
import { PERSONA_TEXT_LIMIT, type PersonaEntry } from '@shared/api/persona-channels';
import { readSkillTechnologies } from '@shared/api/skill-channels';
import {
  SkillImportChannel,
  type SkillExportResult,
  type SkillImportAcceptedPersonaEntry,
  type SkillImportAcceptedSkill,
  type SkillImportCommit,
  type SkillImportDraft,
  type SkillImportPlan,
  type SkillImportResult,
} from '@shared/api/skill-import-channels';
import { showMessageBox, showOpenDialog } from '@shared/electron/dialog-parent';
import { logger } from '@shared/electron/logger';
import { announcePersonaChange } from '../persona/persona-handlers';
import { readEntry } from '../persona/persona-library';
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
 * Registers the IPC handlers of import and export (#1263), validating everything the renderer sends
 * before the libraries see it.
 */
export class LibraryTransferHandlers {
  /**
   * Initializes a new instance of the {@link LibraryTransferHandlers} class.
   * @param transfer The import and export engine.
   * @param windowGetter Returns the main window, to parent the dialogs.
   */
  public constructor(
    private readonly transfer: LibraryTransfer,
    private readonly windowGetter: () => BrowserWindow | null,
  ) {}

  /**
   * Registers the handlers.
   */
  public register(): void {
    logger.info('LibraryTransferHandlers', 'Registering import and export IPC handlers');
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
      SkillImportChannel.ChoosePersona,
      async (event: IpcMainInvokeEvent): Promise<SkillImportPlan | null> => {
        const result: OpenDialogReturnValue = await showOpenDialog(
          event.sender,
          this.windowGetter,
          {
            title: 'Import into Persona',
            message:
              'Choose Markdown files, a folder of them, or a Studio export. Each file becomes an entry in your persona.',
            buttonLabel: 'Import',
            properties: ['openFile', 'openDirectory', 'multiSelections'],
            filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
          },
        );
        if (result.canceled || result.filePaths.length === 0) {
          return null;
        }
        return this.transfer.scanForPersona(result.filePaths);
      },
    );
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
          return { skills: 0, persona: 0, linksRewritten: 0, error: 'The import was malformed.' };
        }
        const result: SkillImportResult = await this.transfer.commit(commit);
        // Every window is told, the sender too: the import changed the persona behind its back.
        if (result.error === null && result.persona > 0) {
          announcePersonaChange();
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
            message: 'Choose where to save a copy of your skills and persona.',
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
      !Array.isArray(record['persona']) ||
      record['skills'].length > COMMIT_LIMIT ||
      record['persona'].length > COMMIT_LIMIT
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
    const persona: SkillImportAcceptedPersonaEntry[] = [];
    for (const item of record['persona'] as unknown[]) {
      const accepted: Record<string, unknown> | null =
        item !== null && typeof item === 'object' ? (item as Record<string, unknown>) : null;
      const entry: PersonaEntry | null = accepted === null ? null : readEntry(accepted['entry']);
      if (accepted === null || entry === null) {
        return null;
      }
      persona.push({ entry, replace: accepted['replace'] === true });
    }
    return { planId: record['planId'], skills, persona };
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
      fields['description'].length > PERSONA_TEXT_LIMIT
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
