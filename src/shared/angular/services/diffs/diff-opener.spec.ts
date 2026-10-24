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
  SplitNode,
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
  let staged: WritableSignal<readonly GitFileChange[]>;
  let content: FileDiff;
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
    staged = signal<readonly GitFileChange[]>([]);
    content = { original: 'before', modified: 'after' };
    afterRefresh = null;
    refreshes = 0;
    const repositoryStub: Pick<
      Repository,
      'loadDiff' | 'isBound' | 'info' | 'unstaged' | 'staged' | 'conflicted' | 'refreshStatus'
    > = {
      loadDiff: (file: GitFileChange): Promise<FileDiff> => {
        loadedFiles.push(file);
        return Promise.resolve(content);
      },
      isBound: bound,
      info: signal<RepositoryInfo | null>({ root: '/repo', name: 'repo', trust: 'trusted' }),
      unstaged,
      staged,
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

  it('open_inTheBackground_addsTheDiffBehindTheActiveDocument', () => {
    // An agent's open: the user keeps reading what they were reading, and the well is not focused.
    opener.open(change('src/app.ts'));
    dockFocus.focus('somewhere-else');

    opener.open(change('src/other.ts'), undefined, { background: true });

    expect(well().panels).toContain(diffs.idForPath('src/other.ts'));
    expect(well().active).toBe(diffs.idForPath('src/app.ts'));
    expect(dockFocus.focusedStackId()).toBe('somewhere-else');
  });

  it('open_inTheBackgroundWhenAlreadyOpen_leavesTheWellAsItIs', () => {
    opener.open(change('src/app.ts'));
    opener.open(change('src/other.ts'));

    opener.open(change('src/app.ts'), undefined, { background: true });

    expect(well().active).toBe(diffs.idForPath('src/other.ts'));
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

  describe('following the repository', () => {
    /**
     * Lets the fresh contents a reload asked for land.
     */
    async function settle(): Promise<void> {
      TestBed.tick();
      await Promise.resolve();
      await Promise.resolve();
    }

    it('closesTheDiff_onceTheFileIsCommitted', async () => {
      unstaged.set([change('src/app.ts')]);
      await settle();
      opener.open(change('src/app.ts'));
      await settle();

      unstaged.set([]);
      await settle();

      expect(well().panels).not.toContain(diffs.idForPath('src/app.ts'));
    });

    it('readsTheContentsAfresh_whenTheFileChangesAgain', async () => {
      unstaged.set([change('src/app.ts')]);
      await settle();
      opener.open(change('src/app.ts'));
      await settle();

      content = { original: 'before', modified: 'after, and then some' };
      unstaged.set([{ ...change('src/app.ts'), additions: 2 }]);
      await settle();

      const stored: GitFileChange | null = diffs.get(diffs.idForPath('src/app.ts'));
      expect(stored?.modified).toBe('after, and then some');
      expect(stored?.additions).toBe(2);
    });

    it('showsTheStagedSide_onceTheWholeChangeIsStaged', async () => {
      unstaged.set([change('src/app.ts')]);
      await settle();
      opener.open(change('src/app.ts'));
      await settle();

      unstaged.set([]);
      staged.set([{ ...change('src/app.ts'), target: { kind: 'working', staged: true } }]);
      await settle();

      expect(diffs.get(diffs.idForPath('src/app.ts'))?.target).toEqual({
        kind: 'working',
        staged: true,
      });
      expect(well().panels).toContain(diffs.idForPath('src/app.ts'));
    });

    it('leavesACommitsDiffAlone', async () => {
      const committed: GitFileChange = {
        ...change('src/app.ts'),
        target: { kind: 'commit', hash: 'abc123', parent: null },
      };
      opener.open(committed);
      await settle();

      unstaged.set([change('src/other.ts')]);
      await settle();

      expect(well().panels).toContain(diffs.idForPath('src/app.ts'));
      expect(loadedFiles).toHaveLength(1);
    });
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
    function withoutAWell(centrePanel: string = 'history'): string {
      const centre: StackNode = mkStack('tool', [centrePanel], true);
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

    /**
     * Finds the split directly holding a node.
     * @param node The subtree to search.
     * @param childId The identifier of the node whose parent is wanted.
     * @returns Returns the parent split, or null when the node is the root or absent.
     */
    function parentOf(node: DockNode, childId: string): SplitNode | null {
      if (node.kind !== 'split') {
        return null;
      }
      if (node.children.some((child: DockNode): boolean => child.id === childId)) {
        return node;
      }
      for (const child of node.children) {
        const found: SplitNode | null = parentOf(child, childId);
        if (found !== null) {
          return found;
        }
      }
      return null;
    }

    it('open_withHistoryInTheCentre_stacksTheWellAboveIt', () => {
      const centreId: string = withoutAWell('history');

      opener.open(change('src/app.ts'));

      const made: StackNode = well();
      const parent: SplitNode | null = parentOf(dockState.layout(), made.id);
      expect(parent?.dir).toBe('col');
      expect(parent?.children.map((child: DockNode): string => child.id)).toEqual([
        made.id,
        centreId,
      ]);
    });

    it('open_withTheAgentInTheCentre_opensTheWellBesideIt', () => {
      const centreId: string = withoutAWell('agent');

      opener.open(change('src/app.ts'));

      // As a file opened there would: side by side with the agent, not stacked above it.
      const made: StackNode = well();
      const parent: SplitNode | null = parentOf(dockState.layout(), made.id);
      expect(parent?.dir).toBe('row');
      expect(parent?.children.map((child: DockNode): string => child.id)).toEqual([
        made.id,
        centreId,
      ]);
    });
  });
});
