import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { RepositoryInfo } from '@shared/api/source-control-channels';

import { DockFocus } from '@shared/angular/services/dock-layout/dock-focus';
import { DockPanelRegistry } from '@shared/angular/services/dock-layout/dock-panel-registry';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import {
  DockNode,
  mkSplit,
  mkStack,
  StackNode,
} from '@shared/angular/services/dock-layout/dock-node';
import { firstStackOfRole } from '@shared/angular/services/dock-layout/dock-tree';
import { GitFileChange } from '@shared/angular/services/repository/repository-data';
import { Repository } from '@shared/angular/services/repository/repository';
import { FileDiff } from '@shared/angular/services/source-control/source-control-provider';
import { DiffOpener } from './diff-opener';
import { Diffs } from './diffs';

/**
 * Builds a changed file whose diff contents are loaded lazily.
 * @param path The file path relative to the repository root.
 * @returns Returns the file change.
 */
function change(path: string): GitFileChange {
  return {
    path,
    status: 'modified',
    additions: 1,
    deletions: 1,
    language: 'typescript',
    original: '',
    modified: '',
    target: { kind: 'working', staged: false },
  };
}

describe('DiffOpener', () => {
  let opener: DiffOpener;
  let diffs: Diffs;
  let dockState: DockState;
  let dockFocus: DockFocus;
  let registry: DockPanelRegistry;
  let loadedFiles: GitFileChange[];
  let bound: WritableSignal<boolean>;
  let unstaged: WritableSignal<readonly GitFileChange[]>;
  let afterRefresh: readonly GitFileChange[] | null;
  let refreshes: number;

  /**
   * Gets the document well of the current layout.
   * @returns Returns the document stack, which the default layout always contains.
   */
  function well(): StackNode {
    const stack: StackNode | null = firstStackOfRole(dockState.layout(), 'document');
    if (stack === null) {
      throw new Error('The default layout should contain a document well.');
    }
    return stack;
  }

  beforeEach(() => {
    localStorage.clear();
    loadedFiles = [];
    bound = signal<boolean>(true);
    unstaged = signal<readonly GitFileChange[]>([]);
    afterRefresh = null;
    refreshes = 0;
    const repositoryStub: Pick<
      Repository,
      'loadDiff' | 'isBound' | 'info' | 'unstaged' | 'staged' | 'conflicted' | 'refreshStatus'
    > = {
      loadDiff: (file: GitFileChange): Promise<FileDiff> => {
        loadedFiles.push(file);
        return Promise.resolve({ original: 'before', modified: 'after' });
      },
      isBound: bound,
      info: signal<RepositoryInfo | null>({ root: '/repo', name: 'repo' }),
      unstaged,
      staged: signal<readonly GitFileChange[]>([]),
      conflicted: signal<readonly GitFileChange[]>([]),
      refreshStatus: (): Promise<void> => {
        refreshes += 1;
        if (afterRefresh !== null) {
          unstaged.set(afterRefresh);
        }
        return Promise.resolve();
      },
    };
    TestBed.configureTestingModule({
      providers: [{ provide: Repository, useValue: repositoryStub }],
    });
    opener = TestBed.inject(DiffOpener);
    diffs = TestBed.inject(Diffs);
    dockState = TestBed.inject(DockState);
    dockFocus = TestBed.inject(DockFocus);
    registry = TestBed.inject(DockPanelRegistry);
  });

  it('open_whenFirstOpened_registersAndTabsTheDiffIntoTheWell', () => {
    opener.open(change('src/app.ts'));

    const id: string = diffs.idForPath('src/app.ts');
    expect(registry.has(id)).toBe(true);
    expect(registry.get(id)?.title).toBe('app.ts');
    expect(registry.get(id)?.role).toBe('document');
    expect(well().panels).toContain(id);
    expect(well().active).toBe(id);
    expect(diffs.has(id)).toBe(true);
  });

  it('open_whenFirstOpened_focusesTheWell', () => {
    opener.open(change('src/app.ts'));

    expect(dockFocus.focusedStackId()).toBe(well().id);
  });

  it('open_whenTheSameFileIsOpenedAgain_reusesTheExistingTab', () => {
    opener.open(change('src/app.ts'));
    opener.open(change('src/other.ts'));

    opener.open(change('src/app.ts'));

    const paths: readonly string[] = well().panels;
    expect(
      paths.filter((id: string): boolean => id === diffs.idForPath('src/app.ts')),
    ).toHaveLength(1);
    expect(well().active).toBe(diffs.idForPath('src/app.ts'));
  });

  it('open_whenTheProviderResolves_fillsInTheDiffContents', async () => {
    const file: GitFileChange = change('src/app.ts');
    opener.open(file);

    expect(loadedFiles).toEqual([file]);
    await Promise.resolve();
    await Promise.resolve();

    const stored: GitFileChange | null = diffs.get(diffs.idForPath('src/app.ts'));
    expect(stored?.original).toBe('before');
    expect(stored?.modified).toBe('after');
  });

  describe('openPath', () => {
    it('opensTheChangeAtAnAbsolutePath_withoutReadingTheStatusAgain', async () => {
      unstaged.set([change('src/app.ts')]);

      const refusal: string | null = await opener.openPath('/repo/src/app.ts');

      expect(refusal).toBeNull();
      expect(well().active).toBe(diffs.idForPath('src/app.ts'));
      expect(refreshes).toBe(0);
    });

    it('readsTheStatusOnceMore_whenTheChangeHasNotArrivedYet', async () => {
      // The explorers' status can land a moment before this repository's.
      afterRefresh = [change('src/app.ts')];

      const refusal: string | null = await opener.openPath('/repo/src/app.ts');

      expect(refusal).toBeNull();
      expect(refreshes).toBe(1);
      expect(well().active).toBe(diffs.idForPath('src/app.ts'));
    });

    it('refusesAnUnchangedFile_withTheReason', async () => {
      const refusal: string | null = await opener.openPath('/repo/src/same.ts');

      expect(refusal).toBe(
        '"src/same.ts" has no changes against HEAD, so there is no diff to show.',
      );
      expect(registry.has(diffs.idForPath('src/same.ts'))).toBe(false);
    });

    it('refusesAWorkspaceThatIsNotARepository', async () => {
      bound.set(false);

      expect(await opener.openPath('/repo/src/app.ts')).toBe(
        'This workspace is not a git repository, so there is no diff to show.',
      );
    });
  });

  it('open_whenThePathHasNoDirectory_usesTheWholePathAsTheTitle', () => {
    opener.open(change('README.md'));

    expect(registry.get(diffs.idForPath('README.md'))?.title).toBe('README.md');
  });

  describe('a layout with no document well', () => {
    /**
     * Replaces the layout with one that has no document stack at all, as the Git preset does: a
     * centre slot with a tool panel in it and nothing else.
     * @returns Returns the centre stack's id.
     */
    function withoutAWell(): string {
      const centre: StackNode = mkStack('tool', ['history'], true);
      dockState.reset();
      const layout: DockNode = mkSplit('row', [mkStack('tool', ['branches']), centre], [1, 3]);
      (dockState as unknown as { commit(next: DockNode): void }).commit(layout);
      return centre.id;
    }

    it('open_makesOne_ratherThanSilentlyDoingNothing', () => {
      withoutAWell();
      expect(firstStackOfRole(dockState.layout(), 'document')).toBeNull();

      opener.open(change('src/app.ts'));

      // A surface may reasonably start without a well; a diff is what earns it one.
      const made: StackNode | null = firstStackOfRole(dockState.layout(), 'document');
      expect(made).not.toBeNull();
      expect(made?.panels).toContain(diffs.idForPath('src/app.ts'));
      expect(made?.active).toBe(diffs.idForPath('src/app.ts'));
    });

    it('open_madeOnce_isReusedByTheNextDiff', () => {
      withoutAWell();
      opener.open(change('src/app.ts'));
      const first: string | undefined = firstStackOfRole(dockState.layout(), 'document')?.id;

      opener.open(change('src/other.ts'));

      const second: StackNode | null = firstStackOfRole(dockState.layout(), 'document');
      expect(second?.id).toBe(first);
      expect(second?.panels).toHaveLength(2);
    });

    it('open_focusesTheWellItMade', () => {
      withoutAWell();

      opener.open(change('src/app.ts'));

      expect(dockFocus.focusedStackId()).toBe(firstStackOfRole(dockState.layout(), 'document')?.id);
    });
  });
});
