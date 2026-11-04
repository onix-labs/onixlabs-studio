import { computed, Signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { FileInfo, FileWriteResult } from '@shared/api/file-channels';
import type { TextEncoding } from '@shared/api/text-encodings';
import { Notifications } from '@shared/angular/services/notifications/notifications';
import { DockPanelPlaceholder } from '@shared/angular/components/dock-layout/dock-panel-placeholder/dock-panel-placeholder';
import { Icon } from '@shared/angular/icons/icon';
import { DockPanelRegistry } from '@shared/angular/services/dock-layout/dock-panel-registry';
import { FileSystem } from '../file-system/file-system';
import { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { TabCloser } from '@shared/angular/services/tab-closer/tab-closer';
import { provideUnsavedWork } from '@shared/angular/services/unsaved-work/unsaved-work';
import { FileConflicts } from '@shared/angular/services/file-conflicts/file-conflicts';
import { FileWatch } from '@shared/angular/services/file-watch/file-watch';
import { Settings, TextEditorSettings } from '@shared/angular/services/settings/settings';
import { vi } from 'vitest';
import {
  AUTO_SAVE_DELAY_MS,
  CodeDocument,
  Documents,
  effectiveViewToggles,
  SAVE_PREPARATION_TIMEOUT_MS,
} from './documents';
import type {
  EditorConfigProperties,
  EditorConfigResolution,
} from '@shared/api/editor-config-channels';
import { EditorConfigs } from '@shared/angular/services/editor-config/editor-configs';

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

  it('aReadOnlyWellDocument_isNeverDirty_andIsNeverSaved (#1133)', async () => {
    // A language server's decompiled source: shown to read, never written back.
    documents.setOwningTab('workspace-tab');
    const id: string = documents.createWellDocument({ ...SAMPLE_FILE, readOnly: true });
    documents.setContent(id, 'changed');

    expect(documents.get(id)?.readOnly()).toBe(true);
    expect(documents.get(id)?.dirty()).toBe(false);
    expect(documents.dirtyDocuments()).toEqual([]);
    expect(await documents.save(id)).toBe(false);
    expect(await documents.saveAs(id)).toBe(false);
  });

  it('anOrdinaryWellDocument_isEditable', () => {
    const id: string = documents.createWellDocument(SAMPLE_FILE);

    expect(documents.get(id)?.readOnly()).toBe(false);
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
    });

    it('whenAWellDocumentCrossesTheMarkdownBoundary_swapsItsPanelIcon', () => {
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
    });
  });
});

describe('effectiveViewToggles', () => {
  it('followsTheSettingsUntilTheTabSetsItsOwn', () => {
    const settings: { wordWrap: boolean; showMinimap: boolean; showLineNumbers: boolean } = {
      wordWrap: false,
      showMinimap: true,
      showLineNumbers: true,
    };

    expect(effectiveViewToggles({}, settings)).toEqual({
      wordWrap: false,
      minimap: true,
      lineNumbers: true,
    });
    expect(effectiveViewToggles({ minimap: false }, settings)).toEqual({
      wordWrap: false,
      minimap: false,
      lineNumbers: true,
    });
  });
});

describe('Documents, with files on disk (#1236)', () => {
  let documents: Documents;
  let settings: Settings;
  let written: string[];
  let watchers: Map<string, (info: FileInfo) => void>;

  beforeEach(() => {
    localStorage.removeItem('settings');
    written = [];
    watchers = new Map<string, (info: FileInfo) => void>();
    TestBed.configureTestingModule({
      providers: [
        provideUnsavedWork(Documents),
        {
          provide: FileSystem,
          useValue: {
            write: (_path: string, content: string): Promise<{ success: boolean }> => {
              written.push(content);
              return Promise.resolve({ success: true });
            },
          },
        },
        {
          provide: FileWatch,
          useValue: {
            watch: (path: string, onChange: (info: FileInfo) => void): (() => void) => {
              watchers.set(path, onChange);
              return (): void => void watchers.delete(path);
            },
          },
        },
      ],
    });
    documents = TestBed.inject(Documents);
    settings = TestBed.inject(Settings);
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.removeItem('settings');
  });

  it('aNewDocument_startsInDefaultLanguageForNewDocuments', () => {
    settings.set('textEditor.defaultLanguage', 'python');
    const tab: Tab = TestBed.inject(Tabs).open('code');

    expect(documents.ensure(tab.id).language()).toBe('python');
  });

  it('autoSaveAfterADelay_savesOnceTypingPauses_andNeverAnUntitledDocument', async () => {
    vi.useFakeTimers();
    settings.set('textEditor.autoSave', 'delay');
    const tab: Tab = documents.openFileInfo(SAMPLE_FILE, 'code');
    const untitled: Tab = TestBed.inject(Tabs).open('code');
    documents.ensure(untitled.id);

    documents.setContent(tab.id, 'a');
    documents.setContent(untitled.id, 'b');
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS / 2);
    documents.setContent(tab.id, 'ab');
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS / 2);
    expect(written).toEqual([]);

    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS);
    expect(written).toEqual(['ab']);
    expect(documents.get(tab.id)?.dirty()).toBe(false);
    expect(documents.get(untitled.id)?.dirty()).toBe(true);
  });

  it('autoSaveWhenFocusChanges_savesTheDocumentLeft_andOnWindowBlur', async () => {
    settings.set('textEditor.autoSave', 'focus');
    const first: Tab = documents.openFileInfo(SAMPLE_FILE, 'code');
    const second: Tab = documents.openFileInfo(
      { ...SAMPLE_FILE, path: '/ws/other.ts', name: 'other.ts' },
      'code',
    );

    documents.setActiveDocument(first.id);
    documents.setContent(first.id, 'first edit');
    documents.setActiveDocument(second.id);
    await Promise.resolve();
    expect(written).toEqual(['first edit']);

    documents.setContent(second.id, 'second edit');
    window.dispatchEvent(new Event('blur'));
    await Promise.resolve();
    expect(written).toEqual(['first edit', 'second edit']);
  });

  it('autoSaveOff_neverSaves', async () => {
    const tab: Tab = documents.openFileInfo(SAMPLE_FILE, 'code');
    documents.setActiveDocument(tab.id);
    documents.setContent(tab.id, 'edit');
    documents.setActiveDocument(null);
    window.dispatchEvent(new Event('blur'));
    await Promise.resolve();

    expect(written).toEqual([]);
  });

  it('anUneditedDocument_followsReloadFilesChangedOnDisk', () => {
    const tab: Tab = documents.openFileInfo(SAMPLE_FILE, 'code');
    const conflicts: FileConflicts = TestBed.inject(FileConflicts);
    const change: (content: string) => void = (content: string): void =>
      watchers.get(SAMPLE_FILE.path)?.({ ...SAMPLE_FILE, content });

    // Ask, by default: nothing changes until the user answers.
    change('asked');
    expect(documents.get(tab.id)?.content()).toBe(SAMPLE_FILE.content);
    expect(conflicts.activeConflict()).toMatchObject({ documentId: tab.id, unedited: true });
    conflicts.reload(tab.id);
    expect(documents.get(tab.id)?.content()).toBe('asked');

    settings.set('textEditor.reloadOnDiskChange', 'silent');
    change('silent');
    expect(documents.get(tab.id)?.content()).toBe('silent');
    expect(conflicts.activeConflict()).toBeNull();

    settings.set('textEditor.reloadOnDiskChange', 'ignore');
    change('ignored');
    expect(documents.get(tab.id)?.content()).toBe('silent');
    expect(conflicts.activeConflict()).toBeNull();
  });

  it('anEditedDocument_alwaysAsks_whateverTheSetting', () => {
    settings.set('textEditor.reloadOnDiskChange', 'silent');
    const tab: Tab = documents.openFileInfo(SAMPLE_FILE, 'code');
    documents.setContent(tab.id, 'mine');

    watchers.get(SAMPLE_FILE.path)?.({ ...SAMPLE_FILE, content: 'theirs' });

    expect(documents.get(tab.id)?.content()).toBe('mine');
    expect(TestBed.inject(FileConflicts).activeConflict()?.unedited).toBeUndefined();
  });
});

describe('Documents, in an encoding (#1236)', () => {
  let documents: Documents;
  let writes: { content: string; hasBom: boolean; encoding: TextEncoding }[];
  let writeResult: FileWriteResult;
  let reads: { path: string; encoding: TextEncoding | undefined }[];
  let onDisk: FileInfo | null;
  let notified: string[];

  beforeEach(() => {
    localStorage.removeItem('settings');
    writes = [];
    reads = [];
    notified = [];
    writeResult = { success: true, path: SAMPLE_FILE.path };
    onDisk = null;
    TestBed.configureTestingModule({
      providers: [
        provideUnsavedWork(Documents),
        {
          provide: FileSystem,
          useValue: {
            write: (
              _path: string,
              content: string,
              hasBom: boolean,
              encoding: TextEncoding,
            ): Promise<FileWriteResult> => {
              writes.push({ content, hasBom, encoding });
              return Promise.resolve(writeResult);
            },
            read: (path: string, encoding?: TextEncoding): Promise<FileInfo | null> => {
              reads.push({ path, encoding });
              return Promise.resolve(onDisk);
            },
          },
        },
        {
          provide: FileWatch,
          useValue: { watch: (): (() => void) => (): void => undefined },
        },
        {
          provide: Notifications,
          useValue: {
            notify: (request: { readonly title: string }): void =>
              void notified.push(request.title),
          },
        },
      ],
    });
    documents = TestBed.inject(Documents);
  });

  afterEach(() => {
    localStorage.removeItem('settings');
  });

  it('savesAFileInTheEncodingItWasReadIn', async () => {
    const tab: Tab = documents.openFileInfo(
      { ...SAMPLE_FILE, encoding: 'utf16le', hasBom: true },
      'code',
    );
    documents.setContent(tab.id, 'changed');

    expect(await documents.save(tab.id)).toBe(true);
    expect(writes).toEqual([{ content: 'changed', hasBom: true, encoding: 'utf16le' }]);
  });

  it('aNewDocument_startsInDefaultEncoding_withAByteOrderMarkForUtf16', () => {
    TestBed.inject(Settings).set('textEditor.defaultEncoding', 'utf16be');
    const tab: Tab = TestBed.inject(Tabs).open('code');

    const document: CodeDocument = documents.ensure(tab.id);
    expect(document.encoding()).toBe('utf16be');
    expect(document.hasBom()).toBe(true);
  });

  it('saveWithEncoding_switchesTheEncoding_andKeepsTheOldOneWhenTheSaveFails', async () => {
    const tab: Tab = documents.openFileInfo({ ...SAMPLE_FILE, encoding: 'utf8' }, 'code');

    expect(await documents.saveWithEncoding(tab.id, 'windows1252')).toBe(true);
    expect(writes[0]).toEqual({
      content: SAMPLE_FILE.content,
      hasBom: false,
      encoding: 'windows1252',
    });
    expect(documents.get(tab.id)?.encoding()).toBe('windows1252');

    writeResult = { success: false, error: 'The text cannot be saved in ISO 8859-1: “€”' };
    expect(await documents.saveWithEncoding(tab.id, 'iso88591')).toBe(false);
    expect(documents.get(tab.id)?.encoding()).toBe('windows1252');
    // A failed save says why, rather than failing silently.
    expect(notified).toEqual(["main.ts wasn't saved"]);
  });

  it('reopenWithEncoding_readsTheFileAgainInIt_andGivesUpTheEdits', async () => {
    const tab: Tab = documents.openFileInfo({ ...SAMPLE_FILE, encoding: 'utf8' }, 'code');
    documents.setContent(tab.id, 'unsaved');
    onDisk = { ...SAMPLE_FILE, content: 'naÃ¯ve', encoding: 'iso88591', hasBom: false };

    expect(await documents.reopenWithEncoding(tab.id, 'iso88591')).toBe(true);

    expect(reads).toEqual([{ path: SAMPLE_FILE.path, encoding: 'iso88591' }]);
    const document: CodeDocument | undefined = documents.get(tab.id);
    expect(document?.content()).toBe('naÃ¯ve');
    expect(document?.dirty()).toBe(false);
    expect(document?.encoding()).toBe('iso88591');
  });
});

describe('Documents, under an .editorconfig (#1049)', () => {
  let documents: Documents;
  let resolution: EditorConfigResolution;
  let writes: { content: string; hasBom: boolean; encoding: TextEncoding }[];
  let onChange: (() => void) | undefined;
  let onDisk: ((info: FileInfo) => void) | undefined;
  let conflicts: number;

  beforeEach(() => {
    localStorage.removeItem('settings');
    resolution = { properties: {}, candidates: ['/ws/.editorconfig'] };
    writes = [];
    onChange = undefined;
    onDisk = undefined;
    conflicts = 0;
    TestBed.configureTestingModule({
      providers: [
        provideUnsavedWork(Documents),
        {
          provide: FileSystem,
          useValue: {
            write: (
              path: string,
              content: string,
              hasBom: boolean,
              encoding: TextEncoding,
            ): Promise<FileWriteResult> => {
              writes.push({ content, hasBom, encoding });
              return Promise.resolve({ success: true, path });
            },
            saveDialog: (): Promise<string> => Promise.resolve('/ws/new.ts'),
          },
        },
        {
          provide: FileWatch,
          useValue: {
            watch: (_path: string, callback: (info: FileInfo) => void): (() => void) => {
              onDisk = callback;
              return (): void => undefined;
            },
          },
        },
        {
          provide: FileConflicts,
          useValue: {
            changedOnDisk: (): void => void (conflicts += 1),
            raise: (): void => void (conflicts += 1),
            clear: (): void => undefined,
          },
        },
        {
          provide: EditorConfigs,
          useValue: {
            resolve: (): Promise<EditorConfigResolution> => Promise.resolve(resolution),
            watch: (_candidates: readonly string[], callback: () => void): (() => void) => {
              onChange = callback;
              return (): void => undefined;
            },
          },
        },
      ],
    });
    documents = TestBed.inject(Documents);
  });

  afterEach(() => {
    localStorage.removeItem('settings');
  });

  /**
   * Opens a file and lets EditorConfig answer.
   * @param properties What EditorConfig says.
   * @param file The file.
   * @returns Returns the tab.
   */
  async function open(
    properties: EditorConfigProperties,
    file: FileInfo = SAMPLE_FILE,
  ): Promise<Tab> {
    resolution = { properties, candidates: ['/ws/.editorconfig'] };
    const tab: Tab = documents.openFileInfo(file, 'code');
    await Promise.resolve();
    await Promise.resolve();
    return tab;
  }

  it('saveSettings_applyWhereNoEditorConfigSpeaks', async () => {
    TestBed.inject(Settings).set('textEditor.global.trimTrailingWhitespace', true);
    TestBed.inject(Settings).set('textEditor.global.insertFinalNewline', true);
    const tab: Tab = await open({});
    documents.setContent(tab.id, 'a  \nb');

    await documents.save(tab.id);

    expect(writes.at(-1)?.content).toBe('a\nb\n');
  });

  it('saveSettings_giveWayToWhatAnEditorConfigStates', async () => {
    TestBed.inject(Settings).set('textEditor.global.trimTrailingWhitespace', true);
    const tab: Tab = await open({ trimTrailingWhitespace: false });
    documents.setContent(tab.id, 'a  ');

    await documents.save(tab.id);

    expect(writes.at(-1)?.content).toBe('a  ');
  });

  it('autoSaveAfterADelay_leavesTheTextAlone_evenWhereAnEditorConfigTrims', async () => {
    vi.useFakeTimers();
    TestBed.inject(Settings).set('textEditor.autoSave', 'delay');
    const prepared: string[] = [];
    const tab: Tab = await open({ trimTrailingWhitespace: true, insertFinalNewline: true });
    TestBed.inject(Settings).set('textEditor.global.formatOnSave', 'whole');
    documents.registerSavePreparer(tab.id, (): Promise<void> => {
      prepared.push(tab.id);
      return Promise.resolve();
    });

    documents.setContent(tab.id, 'typing ');
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS);

    expect(writes.at(-1)?.content).toBe('typing ');
    expect(documents.get(tab.id)?.content()).toBe('typing ');
    expect(prepared).toEqual([]);
    vi.useRealTimers();
  });

  it('autoSaveOnFocusChange_appliesTheRules', async () => {
    TestBed.inject(Settings).set('textEditor.autoSave', 'focus');
    const tab: Tab = await open({ trimTrailingWhitespace: true });
    documents.setContent(tab.id, 'a ');
    documents.setActiveDocument(tab.id);

    documents.setActiveDocument(null);
    await vi.waitFor((): void => expect(writes.at(-1)?.content).toBe('a'));
  });

  it('formatOnSave_runsTheEditorBeforeWriting_withTheSavedText', async () => {
    TestBed.inject(Settings).set('textEditor.global.formatOnSave', 'changed');
    const tab: Tab = await open({});
    documents.setContent(tab.id, 'messy');
    const seen: string[] = [];
    documents.registerSavePreparer(
      tab.id,
      (settings: TextEditorSettings, savedContent: string): Promise<void> => {
        seen.push(settings.formatOnSave, savedContent);
        documents.setContent(tab.id, 'tidy');
        return Promise.resolve();
      },
    );

    await documents.save(tab.id);

    expect(seen).toEqual(['changed', SAMPLE_FILE.content]);
    expect(writes.at(-1)?.content).toBe('tidy');
  });

  it('formatOnSave_whenOff_leavesTheEditorAlone', async () => {
    const tab: Tab = await open({});
    let prepared: boolean = false;
    documents.registerSavePreparer(tab.id, (): Promise<void> => {
      prepared = true;
      return Promise.resolve();
    });

    await documents.save(tab.id);

    expect(prepared).toBe(false);
  });

  it('formatOnSave_whenTheFormatterFails_stillSaves', async () => {
    TestBed.inject(Settings).set('textEditor.global.formatOnSave', 'whole');
    const tab: Tab = await open({});
    documents.setContent(tab.id, 'edit');
    documents.registerSavePreparer(tab.id, (): Promise<void> =>
      Promise.reject(new Error('no formatter')),
    );

    expect(await documents.save(tab.id)).toBe(true);
    expect(writes.at(-1)?.content).toBe('edit');
  });

  it('formatOnSave_whenTheFormatterHangs_savesOnceTheWaitIsOver', async () => {
    vi.useFakeTimers();
    TestBed.inject(Settings).set('textEditor.global.formatOnSave', 'whole');
    const tab: Tab = await open({});
    documents.setContent(tab.id, 'edit');
    documents.registerSavePreparer(
      tab.id,
      (): Promise<void> => new Promise<void>((): void => undefined),
    );

    const saved: Promise<boolean> = documents.save(tab.id);
    await vi.advanceTimersByTimeAsync(SAVE_PREPARATION_TIMEOUT_MS);

    expect(await saved).toBe(true);
    expect(writes.at(-1)?.content).toBe('edit');
    vi.useRealTimers();
  });

  it('addByteOrderMark_marksANewUtf8FileWhenFirstSaved', async () => {
    TestBed.inject(Settings).set('textEditor.global.addByteOrderMark', true);
    resolution = { properties: {}, candidates: [] };
    const tab: Tab = TestBed.inject(Tabs).open('code');
    documents.ensure(tab.id);

    await documents.saveAs(tab.id);

    expect(writes.at(-1)?.hasBom).toBe(true);
  });

  it('addByteOrderMark_leavesAnExistingFileAlone', async () => {
    TestBed.inject(Settings).set('textEditor.global.addByteOrderMark', true);
    const tab: Tab = await open({});

    await documents.saveAs(tab.id);

    expect(writes.at(-1)?.hasBom).toBe(false);
  });

  it('addByteOrderMark_givesWayToACharsetInAnEditorConfig', async () => {
    TestBed.inject(Settings).set('textEditor.global.addByteOrderMark', true);
    resolution = { properties: { charset: 'utf-8' }, candidates: [] };
    const tab: Tab = TestBed.inject(Tabs).open('code');
    documents.ensure(tab.id);

    await documents.saveAs(tab.id);

    expect(writes.at(-1)?.hasBom).toBe(false);
  });

  it('writesExactlyWhatItsaysOnSave', async () => {
    const tab: Tab = await open({
      endOfLine: 'crlf',
      trimTrailingWhitespace: true,
      insertFinalNewline: true,
    });
    documents.setContent(tab.id, 'a  \nb');

    await documents.save(tab.id);

    expect(writes[0].content).toBe('a\r\nb\r\n');
    expect(documents.get(tab.id)?.content()).toBe('a\r\nb\r\n');
    expect(documents.get(tab.id)?.dirty()).toBe(false);
  });

  it('changesNothingWithNoEditorConfig', async () => {
    const tab: Tab = await open({});
    documents.setContent(tab.id, 'a  ');

    await documents.save(tab.id);

    expect(writes[0].content).toBe('a  ');
    expect(documents.get(tab.id)?.editorConfig()).toBeNull();
  });

  it('exposesWhatItSaysToTheEditor', async () => {
    const tab: Tab = await open({ indentStyle: 'tab' });

    expect(documents.get(tab.id)?.editorConfig()).toEqual({ indentStyle: 'tab' });
  });

  it('appliesAChangedEditorConfigToAnOpenDocument', async () => {
    const tab: Tab = await open({ indentStyle: 'tab' });

    resolution = { properties: { indentStyle: 'space' }, candidates: [] };
    onChange?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(documents.get(tab.id)?.editorConfig()).toEqual({ indentStyle: 'space' });
  });

  it('savesInTheCharset_andGoesBackWhenItIsTakenAway', async () => {
    const tab: Tab = await open({ charset: 'latin1' });
    documents.setContent(tab.id, 'changed');

    await documents.save(tab.id);
    expect(writes[0]).toMatchObject({ encoding: 'iso88591', hasBom: false });

    resolution = { properties: {}, candidates: [] };
    onChange?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(documents.get(tab.id)?.encoding()).toBe('utf8');
  });

  it('readsUtf8BomAsAByteOrderMark', async () => {
    const tab: Tab = await open({ charset: 'utf-8-bom' });

    expect(documents.get(tab.id)?.hasBom()).toBe(true);
  });

  it('keepsAMarkdownDocumentsTextAndCharset_followingOnlyTheWhitespaceRules', async () => {
    const tab: Tab = await open(
      { trimTrailingWhitespace: true, insertFinalNewline: true, charset: 'latin1' },
      { ...SAMPLE_FILE, path: '/ws/a.md', name: 'a.md' },
    );
    documents.setLanguage(tab.id, 'markdown');
    resolution = {
      properties: { trimTrailingWhitespace: true, insertFinalNewline: true, charset: 'latin1' },
      candidates: [],
    };
    onChange?.();
    await Promise.resolve();
    await Promise.resolve();
    documents.setContent(tab.id, 'a  ');

    await documents.save(tab.id);

    expect(writes[0]).toMatchObject({ content: 'a\n', encoding: 'utf8' });
    expect(documents.get(tab.id)?.content()).toBe('a  ');
    expect(documents.get(tab.id)?.dirty()).toBe(false);

    onDisk?.({ ...SAMPLE_FILE, path: '/ws/a.md', content: 'a\n' });
    expect(conflicts).toBe(0);
  });
});
