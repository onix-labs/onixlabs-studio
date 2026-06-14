import { TestBed } from '@angular/core/testing';

import { Tab } from '../tabs/tab';
import { Tabs } from '../tabs/tabs';
import { FileConflict, FileConflicts } from './file-conflicts';

describe('FileConflicts', () => {
  let conflicts: FileConflicts;
  let tabs: Tabs;

  /**
   * Builds a conflict descriptor for the given tab.
   * @param tabId The tab the conflict surfaces on (also used as the document id).
   * @returns Returns the conflict descriptor.
   */
  function conflictFor(tabId: string): FileConflict {
    return { documentId: tabId, tabId, name: 'main.ts' };
  }

  beforeEach(() => {
    conflicts = TestBed.inject(FileConflicts);
    tabs = TestBed.inject(Tabs);
  });

  it('raise_whenTabActive_exposesItAsTheActiveConflict', () => {
    const tab: Tab = tabs.open('code');

    conflicts.raise(conflictFor(tab.id), { keep: (): void => undefined, reload: (): void => undefined });

    expect(conflicts.activeConflict()?.documentId).toBe(tab.id);
  });

  it('raise_whenTabInactive_leavesTheActiveConflictNull', () => {
    const inactive: Tab = tabs.open('code');
    tabs.open('markdown');

    conflicts.raise(conflictFor(inactive.id), {
      keep: (): void => undefined,
      reload: (): void => undefined,
    });

    expect(conflicts.activeConflict()).toBeNull();
  });

  it('raise_whenSameDocumentRaisedTwice_keepsASingleConflict', () => {
    const tab: Tab = tabs.open('code');

    conflicts.raise(conflictFor(tab.id), {
      keep: (): void => undefined,
      reload: (): void => undefined,
    });
    conflicts.raise(
      { documentId: tab.id, tabId: tab.id, name: 'renamed.ts' },
      { keep: (): void => undefined, reload: (): void => undefined },
    );

    expect(conflicts.activeConflict()?.name).toBe('renamed.ts');
  });

  it('keep_whenResolved_runsTheKeepHandlerAndClearsTheConflict', () => {
    const tab: Tab = tabs.open('code');
    let kept: boolean = false;
    conflicts.raise(conflictFor(tab.id), {
      keep: (): void => {
        kept = true;
      },
      reload: (): void => undefined,
    });

    conflicts.keep(tab.id);

    expect(kept).toBe(true);
    expect(conflicts.activeConflict()).toBeNull();
  });

  it('reload_whenResolved_runsTheReloadHandlerAndClearsTheConflict', () => {
    const tab: Tab = tabs.open('code');
    let reloaded: boolean = false;
    conflicts.raise(conflictFor(tab.id), {
      keep: (): void => undefined,
      reload: (): void => {
        reloaded = true;
      },
    });

    conflicts.reload(tab.id);

    expect(reloaded).toBe(true);
    expect(conflicts.activeConflict()).toBeNull();
  });

  it('clear_whenCalled_removesThePendingConflict', () => {
    const tab: Tab = tabs.open('code');
    conflicts.raise(conflictFor(tab.id), {
      keep: (): void => undefined,
      reload: (): void => undefined,
    });

    conflicts.clear(tab.id);

    expect(conflicts.activeConflict()).toBeNull();
  });
});
