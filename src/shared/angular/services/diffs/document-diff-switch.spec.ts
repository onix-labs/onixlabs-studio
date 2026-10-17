import { Component, Signal, signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { RepositoryInfo } from '@shared/api/source-control-channels';

import { DockPanelSwitch } from '@shared/angular/services/dock-layout/dock-panel';
import { DockPanelRegistry } from '@shared/angular/services/dock-layout/dock-panel-registry';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import { StackNode } from '@shared/angular/services/dock-layout/dock-node';
import { findStackOfPanel, firstStackOfRole } from '@shared/angular/services/dock-layout/dock-tree';
import { Documents } from '@shared/angular/services/documents/documents';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { GitFileChange } from '@shared/angular/services/repository/repository-data';
import { Repository } from '@shared/angular/services/repository/repository';
import { Settings } from '@shared/angular/services/settings/settings';
import { FileDiff } from '@shared/angular/services/source-control/source-control-provider';
import { Diffs } from './diffs';
import { DocumentDiffSwitch } from './document-diff-switch';

/**
 * Stands in for a file tab's component; the switch never renders it.
 */
@Component({ selector: 'app-test-file', template: '' })
class FilePanelStub {}

/**
 * Builds a working-tree change.
 * @param path The file path relative to the repository root.
 * @param status The change's status.
 * @returns Returns the change.
 */
function change(path: string, status: GitFileChange['status'] = 'modified'): GitFileChange {
  return {
    path,
    status,
    additions: 1,
    deletions: 1,
    language: 'typescript',
    original: '',
    modified: '',
    target: { kind: 'working', staged: false },
  };
}

describe('DocumentDiffSwitch', () => {
  let toggle: DocumentDiffSwitch;
  let dockState: DockState;
  let registry: DockPanelRegistry;
  let diffs: Diffs;
  let settings: Settings;
  let unstaged: WritableSignal<readonly GitFileChange[]>;
  /** Maps each open file document's id to its absolute path. */
  let paths: Map<string, string>;
  /** Whether the file being replaced agrees to close. */
  let closes: boolean;

  /**
   * Gets the well of the default layout.
   * @returns Returns the document well.
   */
  function well(): StackNode {
    const stack: StackNode | null = firstStackOfRole(dockState.layout(), 'document');
    if (stack === null) {
      throw new Error('The default layout should contain a document well.');
    }
    return stack;
  }

  /**
   * Opens a file tab in the well, as the file opener would.
   * @param id The document id.
   * @param path The file's absolute path.
   */
  function openFileTab(id: string, path: string): void {
    paths.set(id, path);
    registry.register({
      id,
      title: path.split('/').pop() ?? path,
      icon: undefined as never,
      role: 'document',
      component: FilePanelStub,
      confirmClose: (): Promise<boolean> => Promise.resolve(closes),
    });
    dockState.tabInto(well().id, id);
  }

  /**
   * Lets the switch's awaited steps settle.
   */
  async function settle(): Promise<void> {
    for (let turn: number = 0; turn < 5; turn++) {
      await Promise.resolve();
    }
  }

  beforeEach(() => {
    localStorage.clear();
    unstaged = signal<readonly GitFileChange[]>([]);
    paths = new Map<string, string>();
    closes = true;
    const documentsStub: Pick<Documents, 'get' | 'findIdByPath'> = {
      get: ((id: string) =>
        paths.has(id) ? { filePath: signal(paths.get(id) ?? null) } : undefined) as never,
      findIdByPath: (path: string): string | undefined =>
        [...paths].find(([, candidate]: [string, string]): boolean => candidate === path)?.[0],
    };
    const fileOpenerStub: Pick<FileOpener, 'openPath'> = {
      openPath: (path: string): Promise<boolean> => {
        if ([...paths.values()].includes(path)) {
          return Promise.resolve(true);
        }
        // A new file lands at the end of the layout's first well, as the real opener puts it.
        openFileTab(`doc:${path}`, path);
        return Promise.resolve(true);
      },
    };
    const repositoryStub: Pick<
      Repository,
      'loadDiff' | 'isBound' | 'info' | 'unstaged' | 'staged' | 'conflicted' | 'refreshStatus'
    > = {
      loadDiff: (): Promise<FileDiff> => Promise.resolve({ original: 'a', modified: 'b' }),
      isBound: signal<boolean>(true),
      info: signal<RepositoryInfo | null>({ root: '/repo', name: 'repo', trust: 'trusted' }),
      unstaged,
      staged: signal<readonly GitFileChange[]>([]),
      conflicted: signal<readonly GitFileChange[]>([]),
      refreshStatus: (): Promise<void> => Promise.resolve(),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: Repository, useValue: repositoryStub },
        { provide: Documents, useValue: documentsStub },
        { provide: FileOpener, useValue: fileOpenerStub },
      ],
    });
    toggle = TestBed.inject(DocumentDiffSwitch);
    dockState = TestBed.inject(DockState);
    registry = TestBed.inject(DockPanelRegistry);
    diffs = TestBed.inject(Diffs);
    settings = TestBed.inject(Settings);
    settings.setDocumentDiffSwitch('tab');
  });

  describe('from a file', () => {
    it('isUnavailable_whileTheFileHasNoChanges', () => {
      openFileTab('doc-1', '/repo/src/app.ts');

      const offered: DockPanelSwitch = toggle.forFile('doc-1')();

      expect(offered.label).toBe('Show Diff');
      expect(offered.unavailable).toBe('No changes against HEAD');
    });

    it('becomesAvailable_whenTheFileChanges', () => {
      openFileTab('doc-1', '/repo/src/app.ts');
      const offered: Signal<DockPanelSwitch> = toggle.forFile('doc-1');

      unstaged.set([change('src/app.ts')]);

      expect(offered().unavailable).toBeNull();
    });

    it('inTabMode_opensTheDiffBesideTheFile_andKeepsTheFile', async () => {
      unstaged.set([change('src/app.ts')]);
      openFileTab('doc-1', '/repo/src/app.ts');

      await toggle.forFile('doc-1')().run();
      await settle();

      const diffId: string = diffs.idForPath('src/app.ts');
      expect(well().panels).toEqual(['doc-1', diffId]);
      expect(well().active).toBe(diffId);
    });

    it('inSwapMode_putsTheDiffWhereTheFileWas_andClosesTheFile', async () => {
      settings.setDocumentDiffSwitch('swap');
      unstaged.set([change('src/app.ts')]);
      openFileTab('doc-0', '/repo/src/first.ts');
      openFileTab('doc-1', '/repo/src/app.ts');
      openFileTab('doc-2', '/repo/src/last.ts');

      await toggle.forFile('doc-1')().run();
      await settle();

      expect(well().panels).toEqual(['doc-0', diffs.idForPath('src/app.ts'), 'doc-2']);
    });

    it('inSwapMode_whenTheSavePromptIsCancelled_changesNothing', async () => {
      settings.setDocumentDiffSwitch('swap');
      closes = false;
      unstaged.set([change('src/app.ts')]);
      openFileTab('doc-1', '/repo/src/app.ts');

      const switched: boolean = await toggle.forFile('doc-1')().run();
      await settle();

      expect(switched).toBe(false);
      expect(well().panels).toEqual(['doc-1']);
    });
  });

  describe('from a diff', () => {
    /**
     * Opens a diff tab in the well through a file tab's switch, then closes the file, leaving the
     * diff alone in the well.
     * @param path The changed file, relative to the root.
     * @returns Returns the diff's panel id.
     */
    async function openDiffTab(path: string): Promise<string> {
      unstaged.set([change(path)]);
      openFileTab('seed', `/repo/${path}`);
      await toggle.forFile('seed')().run();
      await settle();
      dockState.removeFromLayout('seed');
      paths.delete('seed');
      return diffs.idForPath(path);
    }

    it('isUnavailable_whenTheChangeDeletesTheFile', () => {
      const id: string = diffs.idForPath('gone.ts');
      diffs.put(id, change('gone.ts', 'deleted'));

      const offered: DockPanelSwitch = toggle.forDiff(id)();

      expect(offered.label).toBe('Show File');
      expect(offered.unavailable).toContain('deletes this file');
    });

    it('inTabMode_opensTheFileBesideTheDiff', async () => {
      const diffId: string = await openDiffTab('src/app.ts');

      await toggle.forDiff(diffId)().run();
      await settle();

      expect(well().panels).toEqual([diffId, 'doc:/repo/src/app.ts']);
      expect(well().active).toBe('doc:/repo/src/app.ts');
    });

    it('inSwapMode_putsTheFileWhereTheDiffWas_andClosesTheDiff', async () => {
      const diffId: string = await openDiffTab('src/app.ts');
      settings.setDocumentDiffSwitch('swap');

      await toggle.forDiff(diffId)().run();
      await settle();

      expect(well().panels).toEqual(['doc:/repo/src/app.ts']);
      expect(findStackOfPanel(dockState.layout(), diffId)).toBeNull();
    });
  });
});
