import { TestBed } from '@angular/core/testing';

import { FileInfo } from '../../../shared/studio-api';
import { Tab } from '../tabs/tab';
import { Tabs } from '../tabs/tabs';
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
});
