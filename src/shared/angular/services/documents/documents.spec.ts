import { computed, Signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { FileInfo } from '@shared/api/file-channels';
import { DockPanelPlaceholder } from '@shared/angular/components/dock-layout/dock-panel-placeholder/dock-panel-placeholder';
import { Icon } from '@shared/angular/icons/icon';
import { DockPanelRegistry } from '@shared/angular/services/dock-layout/dock-panel-registry';
import { FileSystem } from '../file-system/file-system';
import { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { TabCloser } from '@shared/angular/services/tab-closer/tab-closer';
import { provideUnsavedWork } from '@shared/angular/services/unsaved-work/unsaved-work';
import { CodeDocument, Documents } from './documents';

/**
 * A sample file used by the open-from-info tests.
 */
const SAMPLE_FILE: FileInfo = {
  path: '/ws/main.ts',
  name: 'main.ts',
  extension: '.ts',
  content: 'export const x = 1;',
};

describe('Documents', () => {
  let documents: Documents;
  let tabs: Tabs;
  let closer: TabCloser;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideUnsavedWork(Documents)] });
    documents = TestBed.inject(Documents);
    tabs = TestBed.inject(Tabs);
    closer = TestBed.inject(TabCloser);
  });

  it('ensure_whenNoDocument_createsUntitledPlaintextDocument', () => {
    const tab: Tab = tabs.open('code');
    const document: CodeDocument = documents.ensure(tab.id);
    expect(document.fileName()).toBe('Untitled');
    expect(document.language()).toBe('plaintext');
    expect(document.filePath()).toBeNull();
    expect(document.dirty()).toBe(false);
  });

  it('ensure_whenCalledTwice_returnsSameDocument', () => {
    const tab: Tab = tabs.open('code');
    expect(documents.ensure(tab.id)).toBe(documents.ensure(tab.id));
  });

  it('ensure_whenDefaultNameGiven_namesTheNewDocument', () => {
    const tab: Tab = tabs.open('code');
    expect(documents.ensure(tab.id, 'New Document').fileName()).toBe('New Document');
  });

  it('closeViaTabCloser_whenDocumentClean_closesAndReleasesTheTab', async () => {
    const tab: Tab = tabs.open('code');
    documents.ensure(tab.id);

    await closer.close(tab.id);

    expect(tabs.tabs().some((open: Tab): boolean => open.id === tab.id)).toBe(false);
    expect(documents.get(tab.id)).toBeUndefined();
  });

  it('closeViaTabCloser_whenDirtyAndDiscarded_closesTheTab', async () => {
    // Outside Electron the confirm-save dialog defaults to discarding, so the dirty tab closes.
    const tab: Tab = tabs.open('code');
    documents.ensure(tab.id);
    documents.setContent(tab.id, 'changed');

    await closer.close(tab.id);

    expect(tabs.tabs().some((open: Tab): boolean => open.id === tab.id)).toBe(false);
  });

  it('closeViaTabCloser_whenDirtyAndCancelled_keepsTheTabOpen', async () => {
    vi.spyOn(TestBed.inject(FileSystem), 'confirmSave').mockResolvedValue('cancel');
    const tab: Tab = tabs.open('code');
    documents.ensure(tab.id);
    documents.setContent(tab.id, 'changed');

    await closer.close(tab.id);

    expect(tabs.tabs().some((open: Tab): boolean => open.id === tab.id)).toBe(true);
    expect(documents.get(tab.id)).not.toBeUndefined();
  });

  it('setContent_whenContentDiffersFromOriginal_marksDocumentDirty', () => {
    const tab: Tab = tabs.open('code');
    const document: CodeDocument = documents.ensure(tab.id);
    documents.setContent(tab.id, 'changed');
    expect(document.dirty()).toBe(true);
  });

  it('setContent_whenContentDiffersFromOriginal_marksTabDirty', () => {
    const tab: Tab = tabs.open('code');
    documents.ensure(tab.id);
    documents.setContent(tab.id, 'changed');
    expect(tabs.activeTab()?.dirty).toBe(true);
  });

  it('saveActive_whenUntitledOutsideElectron_returnsFalse', async () => {
    const tab: Tab = tabs.open('code');
    documents.ensure(tab.id);
    documents.setContent(tab.id, 'changed');
    expect(await documents.saveActive()).toBe(false);
  });

  it('openFileInfo_whenFileNotOpen_opensSeededTab', () => {
    const tab: Tab = documents.openFileInfo(SAMPLE_FILE, 'code');
    expect(tab.type).toBe('code');
    expect(tab.title).toBe('main.ts');
    expect(documents.get(tab.id)?.content()).toBe(SAMPLE_FILE.content);
    expect(documents.get(tab.id)?.filePath()).toBe(SAMPLE_FILE.path);
    expect(documents.get(tab.id)?.dirty()).toBe(false);
  });

  it('openFileInfo_whenSamePathReopened_reusesTheSameTab', () => {
    const first: Tab = documents.openFileInfo(SAMPLE_FILE, 'code');
    const second: Tab = documents.openFileInfo(SAMPLE_FILE, 'code');
    expect(second.id).toBe(first.id);
    expect(tabs.tabs()).toHaveLength(1);
  });

  it('initialContentOf_whenFileOpened_returnsTheSeededContent', () => {
    const tab: Tab = documents.openFileInfo(SAMPLE_FILE, 'markdown');
    expect(documents.initialContentOf(tab.id)).toBe(SAMPLE_FILE.content);
  });

  it('initialContentOf_whenNoDocument_returnsEmptyString', () => {
    expect(documents.initialContentOf('absent')).toBe('');
  });

  it('initialContentOf_whenContentWasSetBeforeTheEditorMounts_returnsIt', () => {
    // The markdown editor seeds itself once from this and manages its own text thereafter, so it must
    // read the CURRENT content. Reading the last-saved content instead showed a document filled before
    // its view mounted — an agent opening a tab and writing into it — as blank until it was saved.
    const tab: Tab = tabs.open('markdown');
    documents.ensure(tab.id, 'Report');
    documents.setContent(tab.id, '# Findings\n');

    expect(documents.initialContentOf(tab.id)).toBe('# Findings\n');
  });

  it('removeMissing_whenPanelStillPresent_keepsTheDocument', () => {
    const id: string = documents.createWellDocument(SAMPLE_FILE);

    documents.removeMissing(new Set<string>([id]));

    expect(documents.get(id)).not.toBeUndefined();
  });

  it('removeMissing_whenPanelGone_releasesTheDocument', () => {
    const id: string = documents.createWellDocument(SAMPLE_FILE);

    documents.removeMissing(new Set<string>(['some-other-panel']));

    expect(documents.get(id)).toBeUndefined();
  });

  it('dirtyDocuments_whenSomeDirty_listsOnlyThoseWithUnsavedChanges', () => {
    const clean: Tab = tabs.open('code');
    documents.ensure(clean.id);
    const modified: Tab = tabs.open('code');
    const modifiedDocument: CodeDocument = documents.ensure(modified.id);
    documents.setContent(modified.id, 'changed');

    const dirty: readonly { id: string; name: string }[] = documents.dirtyDocuments();

    expect(dirty.map((entry: { id: string }): string => entry.id)).toEqual([modified.id]);
    expect(dirty[0].name).toBe(modifiedDocument.fileName());
  });

  it('dirtyCount_tracksEditsAndMembership_soSurfacesGatingOnUnsavedWorkReDerive', () => {
    expect(documents.dirtyCount()).toBe(0);

    const first: Tab = tabs.open('code');
    documents.ensure(first.id);
    const second: Tab = tabs.open('code');
    documents.ensure(second.id);
    expect(documents.dirtyCount()).toBe(0);

    documents.setContent(first.id, 'changed');
    expect(documents.dirtyCount()).toBe(1);

    documents.setContent(second.id, 'also changed');
    expect(documents.dirtyCount()).toBe(2);

    // Editing back to the saved text is no longer unsaved work.
    documents.setContent(first.id, '');
    expect(documents.dirtyCount()).toBe(1);

    // A document leaving takes its unsaved work with it.
    documents.remove(second.id);
    expect(documents.dirtyCount()).toBe(0);
  });

  it('saveAll_whenNothingIsDirty_succeedsWithoutWritingAnything', async () => {
    const tab: Tab = tabs.open('code');
    documents.ensure(tab.id);

    await expect(documents.saveAll()).resolves.toBe(true);
  });

  it('saveAll_whenADocumentHasNeverBeenSaved_reportsTheFailedSave', async () => {
    // Outside Electron the save dialog resolves to null, so an untitled document cannot be written.
    const tab: Tab = tabs.open('code');
    documents.ensure(tab.id);
    documents.setContent(tab.id, 'changed');

    await expect(documents.saveAll()).resolves.toBe(false);
    expect(documents.dirtyCount()).toBe(1);
  });

  it('dirtyDocumentsFor_asAWorkspaceInstance_returnsItsWellDocsForTheOwningTab_andNoneForOthers', () => {
    // A per-workspace instance hosts every well document under its owning tab.
    documents.setOwningTab('workspace-tab');
    const wellId: string = documents.createWellDocument(SAMPLE_FILE);
    documents.setContent(wellId, 'changed');

    expect(
      documents.dirtyDocumentsFor('workspace-tab').map((d: { id: string }): string => d.id),
    ).toEqual([wellId]);
    expect(documents.dirtyDocumentsFor('another-tab')).toEqual([]);
  });

  it('dirtyDocumentsFor_asARootInstance_returnsOnlyTheDocumentWhoseIdMatchesTheTab', () => {
    // A root instance backs standalone editor tabs, where each document is its own tab.
    const tab: Tab = tabs.open('code');
    documents.ensure(tab.id);
    documents.setContent(tab.id, 'changed');

    expect(documents.dirtyDocumentsFor(tab.id).map((d: { id: string }): string => d.id)).toEqual([
      tab.id,
    ]);
    expect(documents.dirtyDocumentsFor('another-tab')).toEqual([]);
  });

  it('get_whenDocumentCreatedAfterFirstRead_reflectsTheNewDocument', () => {
    const tab: Tab = tabs.open('code');
    const resolved: Signal<CodeDocument | undefined> = computed((): CodeDocument | undefined =>
      documents.get(tab.id),
    );
    // The ribbon reads the active document before the code view has materialised it; the lookup must
    // re-run once the entry is created, not cache the absent document.
    expect(resolved()).toBeUndefined();
    const document: CodeDocument = documents.ensure(tab.id);
    expect(resolved()).toBe(document);
  });

  it('get_whenDocumentRemoved_reflectsTheRemoval', () => {
    const tab: Tab = tabs.open('code');
    documents.ensure(tab.id);
    const resolved: Signal<CodeDocument | undefined> = computed((): CodeDocument | undefined =>
      documents.get(tab.id),
    );
    expect(resolved()).not.toBeUndefined();
    documents.remove(tab.id);
    expect(resolved()).toBeUndefined();
  });

  it('setLanguage_whenLanguageChanged_isReflectedByADocumentResolvingComputed', () => {
    const tab: Tab = tabs.open('code');
    documents.ensure(tab.id);
    const language: Signal<string> = computed(
      (): string => documents.get(tab.id)?.language() ?? 'none',
    );
    expect(language()).toBe('plaintext');
    documents.setLanguage(tab.id, 'typescript');
    expect(language()).toBe('typescript');
  });

  describe('relocate', () => {
    it('whenTheFileItselfIsRenamed_reboundsTheDocumentToTheNewPath', () => {
      // #718: a rename in the Explorer or by an agent left the open document on the old path, so
      // the well tab kept its old title and the next save recreated the old file.
      const id: string = documents.createWellDocument(SAMPLE_FILE);

      const moved: readonly string[] = documents.relocate('/ws/main.ts', '/ws/entry.ts');

      expect(moved).toEqual([id]);
      expect(documents.get(id)?.filePath()).toBe('/ws/entry.ts');
      expect(documents.get(id)?.fileName()).toBe('entry.ts');
      expect(documents.findIdByPath('/ws/entry.ts')).toBe(id);
      expect(documents.findIdByPath('/ws/main.ts')).toBeUndefined();
    });

    it('whenTheFileIsRenamed_followsItOnTheTopLevelTab', () => {
      const tab: Tab = documents.openFileInfo(SAMPLE_FILE, 'code');

      documents.relocate('/ws/main.ts', '/ws/entry.ts');

      expect(tabs.tabs().find((candidate: Tab): boolean => candidate.id === tab.id)?.title).toBe(
        'entry.ts',
      );
    });

    it('whenTheFileIsRenamed_keepsItsContentAndDirtyState', () => {
      const id: string = documents.createWellDocument(SAMPLE_FILE);
      documents.setContent(id, 'edited');

      documents.relocate('/ws/main.ts', '/ws/entry.ts');

      expect(documents.get(id)?.content()).toBe('edited');
      expect(documents.get(id)?.dirty()).toBe(true);
    });

    it('whenAFolderIsRenamed_movesEveryOpenDocumentBeneathIt', () => {
      const inside: string = documents.createWellDocument({
        ...SAMPLE_FILE,
        path: '/ws/src/app/main.ts',
      });
      const deeper: string = documents.createWellDocument({
        ...SAMPLE_FILE,
        path: '/ws/src/app/lib/util.ts',
        name: 'util.ts',
      });
      const outside: string = documents.createWellDocument({
        ...SAMPLE_FILE,
        path: '/ws/src/other.ts',
        name: 'other.ts',
      });

      const moved: readonly string[] = documents.relocate('/ws/src/app', '/ws/src/core');

      expect(moved).toEqual([inside, deeper]);
      expect(documents.get(inside)?.filePath()).toBe('/ws/src/core/main.ts');
      expect(documents.get(deeper)?.filePath()).toBe('/ws/src/core/lib/util.ts');
      expect(documents.get(outside)?.filePath()).toBe('/ws/src/other.ts');
    });

    it('whenAFolderIsRenamed_leavesASiblingSharingThePrefixAlone', () => {
      // '/ws/src-old' starts with '/ws/src' but is not inside it.
      const sibling: string = documents.createWellDocument({
        ...SAMPLE_FILE,
        path: '/ws/src-old/main.ts',
      });

      const moved: readonly string[] = documents.relocate('/ws/src', '/ws/source');

      expect(moved).toEqual([]);
      expect(documents.get(sibling)?.filePath()).toBe('/ws/src-old/main.ts');
    });

    it('whenTheExtensionChanges_redetectsTheLanguage', () => {
      const id: string = documents.createWellDocument(SAMPLE_FILE);
      expect(documents.get(id)?.language()).toBe('typescript');

      documents.relocate('/ws/main.ts', '/ws/notes.md');

      expect(documents.get(id)?.language()).toBe('markdown');
    });

    it('whenTheExtensionIsKept_preservesALanguageChosenByHand', () => {
      // A folder rename, or a rename that keeps the extension, must not undo the user's syntax pick.
      const id: string = documents.createWellDocument(SAMPLE_FILE);
      documents.setLanguage(id, 'javascript');

      documents.relocate('/ws', '/workspace');

      expect(documents.get(id)?.filePath()).toBe('/workspace/main.ts');
      expect(documents.get(id)?.language()).toBe('javascript');
    });

    it('whenNoOpenDocumentIsAffected_returnsNothing', () => {
      documents.createWellDocument(SAMPLE_FILE);

      expect(documents.relocate('/ws/README.md', '/ws/READ.md')).toEqual([]);
    });

    it('whenAWellDocumentIsRenamed_retitlesItsDockPanel', () => {
      // A well document has no top-level tab; its dock panel is the tab whose title must follow.
      const registry: DockPanelRegistry = TestBed.inject(DockPanelRegistry);
      const id: string = documents.createWellDocument(SAMPLE_FILE);
      registry.register({
        id,
        title: 'main.ts',
        icon: Icon.CODE,
        role: 'document',
        component: DockPanelPlaceholder,
      });
      const title: Signal<string> = computed((): string => registry.get(id)?.title ?? 'none');
      expect(title()).toBe('main.ts');

      documents.relocate('/ws/main.ts', '/ws/entry.ts');

      expect(title()).toBe('entry.ts');
      expect(registry.get(id)?.icon).toBe(Icon.CODE);
      expect(registry.get(id)?.ownsToolStrip).toBeUndefined();
    });

    it('whenAWellDocumentCrossesTheMarkdownBoundary_swapsItsPanelIconAndToolStrip', () => {
      const registry: DockPanelRegistry = TestBed.inject(DockPanelRegistry);
      const id: string = documents.createWellDocument(SAMPLE_FILE);
      registry.register({
        id,
        title: 'main.ts',
        icon: Icon.CODE,
        role: 'document',
        component: DockPanelPlaceholder,
      });

      documents.relocate('/ws/main.ts', '/ws/notes.md');

      expect(registry.get(id)?.title).toBe('notes.md');
      expect(registry.get(id)?.icon).toBe(Icon.MARKDOWN);
      expect(registry.get(id)?.ownsToolStrip).toBe(true);
    });
  });
});
