import { TestBed } from '@angular/core/testing';

import { DockFocus } from '@shared/angular/services/dock-layout/dock-focus';
import { DockPanelRegistry } from '@shared/angular/services/dock-layout/dock-panel-registry';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import { StackNode } from '@shared/angular/services/dock-layout/dock-node';
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
    const repositoryStub: Pick<Repository, 'loadDiff'> = {
      loadDiff: (file: GitFileChange): Promise<FileDiff> => {
        loadedFiles.push(file);
        return Promise.resolve({ original: 'before', modified: 'after' });
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

  it('open_whenThePathHasNoDirectory_usesTheWholePathAsTheTitle', () => {
    opener.open(change('README.md'));

    expect(registry.get(diffs.idForPath('README.md'))?.title).toBe('README.md');
  });
});
