import { TestBed } from '@angular/core/testing';

import { Tab } from '../tabs/tab';
import { Tabs } from '../tabs/tabs';
import { CodeDocument, Documents } from './documents';

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
});
