import { computed, Signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { FileInfo } from '../../../shared/studio-api';
import { FileSystem } from '../file-system/file-system';
import { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
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

  beforeEach(() => {
    documents = TestBed.inject(Documents);
    tabs = TestBed.inject(Tabs);
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

  it('closeTab_whenDocumentClean_closesAndReleasesTheTab', async () => {
    const tab: Tab = tabs.open('code');
    documents.ensure(tab.id);

    await documents.closeTab(tab.id);

    expect(tabs.tabs().some((open: Tab): boolean => open.id === tab.id)).toBe(false);
    expect(documents.get(tab.id)).toBeUndefined();
  });

  it('closeTab_whenDirtyAndDiscarded_closesTheTab', async () => {
    // Outside Electron the confirm-save dialog defaults to discarding, so the dirty tab closes.
    const tab: Tab = tabs.open('code');
    documents.ensure(tab.id);
    documents.setContent(tab.id, 'changed');

    await documents.closeTab(tab.id);

    expect(tabs.tabs().some((open: Tab): boolean => open.id === tab.id)).toBe(false);
  });

  it('closeTab_whenDirtyAndCancelled_keepsTheTabOpen', async () => {
    vi.spyOn(TestBed.inject(FileSystem), 'confirmSave').mockResolvedValue('cancel');
    const tab: Tab = tabs.open('code');
    documents.ensure(tab.id);
    documents.setContent(tab.id, 'changed');

    await documents.closeTab(tab.id);

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

  it('get_whenDocumentCreatedAfterFirstRead_reflectsTheNewDocument', () => {
    const tab: Tab = tabs.open('code');
    const resolved: Signal<CodeDocument | undefined> = computed(
      (): CodeDocument | undefined => documents.get(tab.id),
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
    const resolved: Signal<CodeDocument | undefined> = computed(
      (): CodeDocument | undefined => documents.get(tab.id),
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
});
