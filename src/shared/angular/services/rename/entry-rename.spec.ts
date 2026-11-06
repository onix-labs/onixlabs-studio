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
import { EntryRename } from './entry-rename';
import { RenameConfirmation } from './rename-confirmation';

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
            rename: (_path: string, name: string): Promise<FileOperationResult> => {
              order.push(`rename ${name}`);
              return Promise.resolve(result);
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
});
