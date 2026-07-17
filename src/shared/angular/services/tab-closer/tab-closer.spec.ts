import { TestBed } from '@angular/core/testing';

import { FileSystem } from '@shared/angular/services/file-system/file-system';
import { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { UNSAVED_WORK, UnsavedDocument } from '@shared/angular/services/unsaved-work/unsaved-work';
import { UnsavedWorkRegistry } from '@shared/angular/services/unsaved-work/unsaved-work-registry';
import { TabCloser } from './tab-closer';

describe('TabCloser', () => {
  let closer: TabCloser;
  let tabs: Tabs;
  let dirty: UnsavedDocument[];
  let saved: string[];
  let released: string[];

  beforeEach(() => {
    dirty = [];
    saved = [];
    released = [];
    TestBed.configureTestingModule({
      providers: [
        {
          provide: UNSAVED_WORK,
          useValue: {
            dirtyDocuments: (): readonly UnsavedDocument[] => dirty,
            dirtyDocumentsFor: (tabId: string): readonly UnsavedDocument[] =>
              dirty.filter((document: UnsavedDocument): boolean => document.id === tabId),
            save: (id: string): Promise<boolean> => {
              saved.push(id);
              return Promise.resolve(true);
            },
            release: (id: string): void => void released.push(`a:${id}`),
          },
          multi: true,
        },
        {
          provide: UNSAVED_WORK,
          useValue: {
            dirtyDocuments: (): readonly UnsavedDocument[] => [],
            dirtyDocumentsFor: (): readonly UnsavedDocument[] => [],
            save: (): Promise<boolean> => Promise.resolve(true),
            release: (id: string): void => void released.push(`b:${id}`),
          },
          multi: true,
        },
      ],
    });
    closer = TestBed.inject(TabCloser);
    tabs = TestBed.inject(Tabs);
  });

  it('close_whenNoSourceHoldsUnsavedWork_closesAndReleasesEverySource', async () => {
    const tab: Tab = tabs.open('binary');

    await closer.close(tab.id);

    expect(tabs.tabs().some((open: Tab): boolean => open.id === tab.id)).toBe(false);
    expect(released).toEqual([`a:${tab.id}`, `b:${tab.id}`]);
  });

  it('close_whenASourceHoldsUnsavedWork_promptsAndSavesThroughThatSource', async () => {
    // Outside Electron the confirm resolves to discard by default; force a save choice instead.
    vi.spyOn(TestBed.inject(FileSystem), 'confirmSave').mockResolvedValue('save');
    const tab: Tab = tabs.open('binary');
    dirty = [{ id: tab.id, name: 'blob.bin' }];

    await closer.close(tab.id);

    expect(saved).toEqual([tab.id]);
    expect(tabs.tabs().some((open: Tab): boolean => open.id === tab.id)).toBe(false);
  });

  it('close_whenCancelled_keepsTheTabAndReleasesNothing', async () => {
    vi.spyOn(TestBed.inject(FileSystem), 'confirmSave').mockResolvedValue('cancel');
    const tab: Tab = tabs.open('binary');
    dirty = [{ id: tab.id, name: 'blob.bin' }];

    await closer.close(tab.id);

    expect(tabs.tabs().some((open: Tab): boolean => open.id === tab.id)).toBe(true);
    expect(released).toEqual([]);
  });

  it('close_whenAnotherTabIsDirty_closesWithoutPrompting', async () => {
    const confirm: ReturnType<typeof vi.spyOn> = vi.spyOn(
      TestBed.inject(FileSystem),
      'confirmSave',
    );
    const tab: Tab = tabs.open('binary');
    dirty = [{ id: 'some-other-tab', name: 'other.bin' }];

    await closer.close(tab.id);

    expect(confirm).not.toHaveBeenCalled();
    expect(tabs.tabs().some((open: Tab): boolean => open.id === tab.id)).toBe(false);
  });

  it('close_whenTheTabHostsSeveralWellDocuments_promptsAndSavesEachByItsOwnId', async () => {
    // A workspace tab hosts many well documents under one tab id, registered at runtime; closing it
    // must prompt for every dirty well document and save each by its own id (not the tab id) — the
    // #231 regression, where only a document whose id equalled the tab id was resolved.
    vi.spyOn(TestBed.inject(FileSystem), 'confirmSave').mockResolvedValue('save');
    const tab: Tab = tabs.open('directory');
    const wellSaves: string[] = [];
    TestBed.inject(UnsavedWorkRegistry).register({
      dirtyDocuments: (): readonly UnsavedDocument[] => [],
      dirtyDocumentsFor: (tabId: string): readonly UnsavedDocument[] =>
        tabId === tab.id
          ? [
              { id: 'well-a', name: 'a.ts' },
              { id: 'well-b', name: 'b.ts' },
            ]
          : [],
      save: (id: string): Promise<boolean> => {
        wellSaves.push(id);
        return Promise.resolve(true);
      },
      release: (): void => undefined,
    });

    await closer.close(tab.id);

    expect(wellSaves).toEqual(['well-a', 'well-b']);
    expect(tabs.tabs().some((open: Tab): boolean => open.id === tab.id)).toBe(false);
  });
});
