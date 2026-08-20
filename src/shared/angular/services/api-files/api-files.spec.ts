import { TestBed } from '@angular/core/testing';
import { API_DOCUMENT_KIND, ApiDocument, isApiDocumentName } from '@shared/api/api-client-types';
import { FileInfo } from '@shared/api/file-channels';
import { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { ApiFiles, OpenApiDocument } from './api-files';

describe('ApiFiles', () => {
  let apiFiles: ApiFiles;
  let tabs: Tabs;

  /**
   * Builds a file info carrying the given contents.
   * @param name The file name.
   * @param content The file's contents.
   * @returns Returns the file info.
   */
  function file(name: string, content: string): FileInfo {
    return { path: `/tmp/${name}`, name, extension: '.json', content };
  }

  /**
   * Serialises a minimal API document.
   * @param overrides Properties to override on the document.
   * @returns Returns the document as text.
   */
  function documentText(overrides: Partial<ApiDocument> = {}): string {
    return JSON.stringify({
      kind: API_DOCUMENT_KIND,
      version: 1,
      folders: [{ id: 'c1', parentId: null, name: 'Orders' }],
      requests: [],
      environments: [],
      activeEnvironmentId: null,
      ...overrides,
    });
  }

  beforeEach(() => {
    globalThis.localStorage?.clear();
    TestBed.configureTestingModule({});
    apiFiles = TestBed.inject(ApiFiles);
    tabs = TestBed.inject(Tabs);
  });

  it('isApiDocumentName_matchesTheSuffixAndNothingElse', () => {
    expect(isApiDocumentName('orders.api.json')).toBe(true);
    expect(isApiDocumentName('Orders.API.JSON')).toBe(true);
    // A plain JSON file is not ours, and neither is a name that merely mentions the word.
    expect(isApiDocumentName('orders.json')).toBe(false);
    expect(isApiDocumentName('api.json.txt')).toBe(false);
  });

  it('parse_whenTheMonikerIsPresent_readsTheDocument', () => {
    const document: ApiDocument | null = apiFiles.parse(documentText());

    expect(document?.kind).toBe(API_DOCUMENT_KIND);
    expect(document?.folders).toHaveLength(1);
  });

  it('parse_whenTheMonikerIsAbsent_declinesTheFile', () => {
    // Someone else's JSON that happens to be named like ours must not be loaded as a workspace.
    expect(apiFiles.parse(JSON.stringify({ folders: [], requests: [] }))).toBeNull();
  });

  it('parse_whenTheJsonIsMalformed_declinesTheFile', () => {
    expect(apiFiles.parse('{ "kind": "onixlabs.studio.api", ')).toBeNull();
  });

  it('parse_whenTheVersionIsNewerThanThisBuild_declinesTheFile', () => {
    expect(apiFiles.parse(documentText({ version: 99 }))).toBeNull();
  });

  it('parse_whenACollectionListIsMissing_declinesTheFile', () => {
    expect(
      apiFiles.parse(JSON.stringify({ kind: API_DOCUMENT_KIND, version: 1, folders: [] })),
    ).toBeNull();
  });

  it('open_whenTheFileIsADocument_opensATabTitledAfterItAndStashesTheDocument', () => {
    expect(apiFiles.open(file('orders.api.json', documentText()))).toBe(true);

    const tab: Tab | undefined = tabs.findByResource('api-explorer', '/tmp/orders.api.json');
    expect(tab?.title).toBe('orders.api.json');

    const opened: OpenApiDocument | undefined = apiFiles.takeInitial(tab!.id);
    expect(opened?.path).toBe('/tmp/orders.api.json');
    expect(opened?.document.folders).toHaveLength(1);
    // Taken once: a tab that reloads must not silently discard what the user has since edited.
    expect(apiFiles.takeInitial(tab!.id)).toBeUndefined();
  });

  it('open_whenTheFileIsAlreadyOpen_activatesThatTabRatherThanOpeningASecond', () => {
    apiFiles.open(file('orders.api.json', documentText()));
    const first: Tab | undefined = tabs.findByResource('api-explorer', '/tmp/orders.api.json');
    tabs.open('terminal');

    expect(apiFiles.open(file('orders.api.json', documentText()))).toBe(true);

    expect(tabs.activeTabId()).toBe(first?.id);
    expect(
      tabs.tabs().filter((candidate: Tab): boolean => candidate.type === 'api-explorer'),
    ).toHaveLength(1);
  });

  it('open_whenTheFileIsNotADocument_declinesItSoItOpensAsText', () => {
    expect(apiFiles.open(file('orders.api.json', 'not json at all'))).toBe(false);

    expect(tabs.tabs().some((candidate: Tab): boolean => candidate.type === 'api-explorer')).toBe(
      false,
    );
  });
});
