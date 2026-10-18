import { TestBed } from '@angular/core/testing';
import { GitFileChange } from '@shared/angular/services/repository/repository-data';
import { Diffs, OpenDiffEditor } from './diffs';

/**
 * Builds a minimal file change for the store tests.
 * @param path The file path.
 * @returns Returns a file change at the given path.
 */
function change(path: string): GitFileChange {
  return {
    path,
    status: 'modified',
    additions: 1,
    deletions: 0,
    language: 'typescript',
    original: 'a',
    modified: 'b',
  };
}

describe('Diffs', () => {
  let diffs: Diffs;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [Diffs] });
    diffs = TestBed.inject(Diffs);
  });

  it('idForPath_namespacesTheId', () => {
    expect(diffs.idForPath('src/a.ts')).toBe('diff:src/a.ts');
  });

  it('put_thenGet_returnsTheStoredChange', () => {
    const id: string = diffs.idForPath('src/a.ts');
    diffs.put(id, change('src/a.ts'));

    expect(diffs.has(id)).toBe(true);
    expect(diffs.get(id)?.path).toBe('src/a.ts');
  });

  it('toggleInline_flipsTheSharedPreference', () => {
    expect(diffs.inlineDiff()).toBe(false);

    diffs.toggleInline();

    expect(diffs.inlineDiff()).toBe(true);
  });

  it('setInline_asksForALayoutRatherThanForTheOtherOne', () => {
    // What a two-choice control needs: picking the same layout twice must leave it there.
    diffs.setInline(true);
    expect(diffs.inlineDiff()).toBe(true);

    diffs.setInline(true);
    expect(diffs.inlineDiff()).toBe(true);

    diffs.setInline(false);
    expect(diffs.inlineDiff()).toBe(false);
  });

  it('removeMissing_dropsRecordsNotInTheLayout', () => {
    const kept: string = diffs.idForPath('src/a.ts');
    const gone: string = diffs.idForPath('src/b.ts');
    diffs.put(kept, change('src/a.ts'));
    diffs.put(gone, change('src/b.ts'));

    diffs.removeMissing(new Set<string>([kept]));

    expect(diffs.has(kept)).toBe(true);
    expect(diffs.has(gone)).toBe(false);
  });

  it('registerEditor_listsTheOpenDiffsEditors_untilEachIsUnregistered', () => {
    const first: OpenDiffEditor = {
      id: 'diff:a',
      path: () => '/ws/a.ts',
      modifiedEditor: () => null,
    };
    const stale: OpenDiffEditor = {
      id: 'diff:a',
      path: () => '/ws/a.ts',
      modifiedEditor: () => null,
    };
    diffs.registerEditor(first);

    // Only the registration for an id unregisters it: a stale panel cannot drop its successor.
    diffs.unregisterEditor(stale);
    expect(diffs.openEditors()).toEqual([first]);

    diffs.unregisterEditor(first);
    expect(diffs.openEditors()).toEqual([]);
  });
});
