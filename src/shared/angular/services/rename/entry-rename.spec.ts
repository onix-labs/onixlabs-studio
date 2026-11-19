import { TestBed } from '@angular/core/testing';
import type { Mock } from 'vitest';
import type { FileOperationResult } from '@shared/api/workspace-channels';
import { Documents } from '@shared/angular/services/documents/documents';
import { LspClient } from '@shared/angular/services/lsp/lsp-client';
import { Settings } from '@shared/angular/services/settings/settings';
import type {
  WorkspaceEditOutcome,
  WorkspaceTextEdits,
} from '@shared/angular/services/workspace-edit/workspace-edit';
import { WorkspaceEditApplier } from '@shared/angular/services/workspace-edit/workspace-edit-applier';
import { Workspace } from '@shared/angular/services/workspace/workspace';
import { Notifications } from '@shared/angular/services/notifications/notifications';
import { EntryRename } from './entry-rename';
import { RenameConfirmation } from './rename-confirmation';
import { TypeRename } from './type-rename';

/**
 * Edits to two files, as a server answers for a file imported twice.
 */
const TWO_FILES: WorkspaceTextEdits = {
  files: [
    { path: '/ws/a.ts', edits: [] },
    { path: '/ws/b.ts', edits: [] },
  ],
  refused: [],
};

describe('EntryRename (#1207)', () => {
  let order: string[];
  let applied: WorkspaceTextEdits[];
  let outcome: WorkspaceEditOutcome;
  let result: FileOperationResult;
  let settings: Record<string, boolean>;
  let edits: Mock<LspClient['fileRenameEdits']>;
  let confirm: Mock<RenameConfirmation['ask']>;
  let save: Mock<Documents['save']>;
  let typeEdits: Mock<TypeRename['editsFor']>;
  let notified: string[];
  let renames: Map<string, FileOperationResult>;

  /**
   * Builds the service with its collaborators faked.
   * @returns Returns it.
   */
  function build(): EntryRename {
    TestBed.configureTestingModule({
      providers: [
        EntryRename,
        { provide: LspClient, useValue: { fileRenameEdits: edits } },
        { provide: RenameConfirmation, useValue: { ask: confirm } },
        {
          provide: Workspace,
          useValue: {
            rename: (path: string, name: string): Promise<FileOperationResult> => {
              order.push(`rename ${name}`);
              return Promise.resolve(renames.get(path) ?? result);
            },
          },
        },
        {
          provide: WorkspaceEditApplier,
          useValue: {
            apply: (applying: WorkspaceTextEdits): Promise<WorkspaceEditOutcome> => {
              order.push('apply');
              applied.push(applying);
              return Promise.resolve(outcome);
            },
          },
        },
        {
          provide: Documents,
          useValue: {
            findIdByPath: (path: string): string | undefined =>
              path === '/ws/a.ts' ? 'doc-a' : undefined,
            save,
          },
        },
        { provide: Settings, useValue: { get: (key: string): boolean => settings[key] } },
        { provide: TypeRename, useValue: { editsFor: typeEdits } },
        {
          provide: Notifications,
          useValue: {
            notify: (request: { title: string }): void => {
              notified.push(request.title);
            },
          },
        },
      ],
    });
    return TestBed.inject(EntryRename);
  }

  beforeEach(() => {
    order = [];
    applied = [];
    outcome = { applied: [], skipped: [] };
    result = { success: true, path: '/ws/new.ts' };
    settings = { 'textEditor.confirmMultiFileRename': true, 'textEditor.saveAfterRename': false };
    edits = vi.fn<LspClient['fileRenameEdits']>().mockResolvedValue({ files: [], refused: [] });
    confirm = vi.fn<RenameConfirmation['ask']>().mockResolvedValue(true);
    save = vi.fn<Documents['save']>().mockResolvedValue(true);
    typeEdits = vi.fn<TypeRename['editsFor']>().mockResolvedValue(null);
    notified = [];
    renames = new Map<string, FileOperationResult>();
  });

  it('rename_withNothingFollowing_justRenames', async () => {
    await expect(build().rename('/ws/old.ts', 'new.ts')).resolves.toEqual(result);

    expect(edits).toHaveBeenCalledWith('/ws/old.ts', '/ws/new.ts');
    expect(order).toEqual(['rename new.ts']);
  });

  it('rename_appliesAfterTheRename_withTheEntryItselfFollowing', async () => {
    edits.mockResolvedValue({ files: [{ path: '/ws/old.ts', edits: [] }], refused: [] });

    await build().rename('/ws/old.ts', 'new.ts');

    expect(order).toEqual(['rename new.ts', 'apply']);
    expect(applied[0].files[0].path).toBe('/ws/new.ts');
    expect(confirm).not.toHaveBeenCalled();
  });

  it('rename_thatIsRefused_changesNothing', async () => {
    edits.mockResolvedValue(TWO_FILES);
    result = { success: false, error: 'It exists' };

    await expect(build().rename('/ws/old.ts', 'new.ts')).resolves.toEqual(result);

    expect(order).toEqual(['rename new.ts']);
  });

  it('rename_changingSeveralFiles_isConfirmedFirst', async () => {
    edits.mockResolvedValue(TWO_FILES);

    await build().rename('/ws/old.ts', 'new.ts');

    expect(confirm.mock.calls[0][0]).toMatchObject({
      oldName: 'old.ts',
      newName: 'new.ts',
      title: 'Update References to old.ts?',
      confirmLabel: 'Update',
    });
    expect(order).toEqual(['rename new.ts', 'apply']);
  });

  it('rename_declined_stillRenames_alone', async () => {
    edits.mockResolvedValue(TWO_FILES);
    confirm.mockResolvedValue(false);

    await build().rename('/ws/old.ts', 'new.ts');

    expect(order).toEqual(['rename new.ts']);
  });

  it('rename_withConfirmationTurnedOff_appliesWithoutAsking', async () => {
    edits.mockResolvedValue(TWO_FILES);
    settings['textEditor.confirmMultiFileRename'] = false;

    await build().rename('/ws/old.ts', 'new.ts');

    expect(confirm).not.toHaveBeenCalled();
    expect(order).toEqual(['rename new.ts', 'apply']);
  });

  it('rename_withSaveAfterRename_savesTheOpenFilesItChanged', async () => {
    edits.mockResolvedValue(TWO_FILES);
    settings['textEditor.saveAfterRename'] = true;
    outcome = {
      applied: [
        { path: '/ws/a.ts', edits: 1, where: 'editor' },
        { path: '/ws/b.ts', edits: 1, where: 'disk' },
      ],
      skipped: [],
    };

    await build().rename('/ws/old.ts', 'new.ts');

    expect(save).toHaveBeenCalledExactlyOnceWith('doc-a');
  });

  it('rename_withoutSaveAfterRename_leavesTheOpenFilesUnsaved', async () => {
    edits.mockResolvedValue(TWO_FILES);
    outcome = { applied: [{ path: '/ws/a.ts', edits: 1, where: 'editor' }], skipped: [] };

    await build().rename('/ws/old.ts', 'new.ts');

    expect(save).not.toHaveBeenCalled();
  });

  describe('renameGroup (File Nesting)', () => {
    const NESTED: readonly string[] = ['/ws/Enumeration.Comparable.cs', '/ws/Enumeration.From.cs'];

    beforeEach((): void => {
      result = { success: true, path: '/ws/Ordinal.cs' };
      renames.set('/ws/Enumeration.Comparable.cs', {
        success: true,
        path: '/ws/Ordinal.Comparable.cs',
      });
      renames.set('/ws/Enumeration.From.cs', { success: true, path: '/ws/Ordinal.From.cs' });
    });

    it('renamesTheNestedFilesAlongWithTheirParent', async () => {
      await expect(
        build().renameGroup('/ws/Enumeration.cs', 'Ordinal.cs', NESTED),
      ).resolves.toEqual(result);

      expect(order).toEqual([
        'rename Ordinal.cs',
        'rename Ordinal.Comparable.cs',
        'rename Ordinal.From.cs',
      ]);
      expect(edits).toHaveBeenCalledWith('/ws/Enumeration.From.cs', '/ws/Ordinal.From.cs');
    });

    it('renamesTheTypeTheFilesShare_afterTheFiles_wherever_theyNowAre', async () => {
      typeEdits.mockResolvedValue({
        files: [
          { path: '/ws/Enumeration.cs', edits: [] },
          { path: '/ws/Enumeration.From.cs', edits: [] },
          { path: '/ws/Program.cs', edits: [] },
        ],
        refused: [],
      });

      await build().renameGroup('/ws/Enumeration.cs', 'Ordinal.cs', NESTED);

      expect(typeEdits).toHaveBeenCalledWith('/ws/Enumeration.cs', 'Enumeration', 'Ordinal');
      expect(confirm.mock.calls[0][0]).toMatchObject({ title: 'Rename Enumeration to Ordinal?' });
      expect(order.at(-1)).toBe('apply');
      expect(applied[0].files.map((file: { path: string }): string => file.path)).toEqual([
        '/ws/Ordinal.cs',
        '/ws/Ordinal.From.cs',
        '/ws/Program.cs',
      ]);
    });

    it('declined_stillRenamesTheFiles_alone', async () => {
      typeEdits.mockResolvedValue(TWO_FILES);
      confirm.mockResolvedValue(false);

      await build().renameGroup('/ws/Enumeration.cs', 'Ordinal.cs', NESTED);

      expect(order).not.toContain('apply');
      expect(order).toHaveLength(3);
    });

    it('aRefusedParent_leavesTheNestedFilesAlone', async () => {
      result = { success: false, error: 'It exists' };

      await build().renameGroup('/ws/Enumeration.cs', 'Ordinal.cs', NESTED);

      expect(order).toEqual(['rename Ordinal.cs']);
    });

    it('aNestedFileThatCannotFollow_isReported', async () => {
      renames.set('/ws/Enumeration.From.cs', { success: false, error: 'Locked' });

      await build().renameGroup('/ws/Enumeration.cs', 'Ordinal.cs', NESTED);

      expect(notified).toEqual(["Couldn't rename Enumeration.From.cs"]);
    });

    it('keepingTheSameBaseName_asksNothingOfTheType', async () => {
      await build().renameGroup('/ws/Enumeration.cs', 'Enumeration.vb', NESTED);

      expect(typeEdits).not.toHaveBeenCalled();
      expect(order).toEqual(['rename Enumeration.vb']);
    });
  });
});
