import { TestBed } from '@angular/core/testing';
import { DirectoryListing, OpenSelection, WorkspaceApi } from '../../../shared/studio-api';
import { StackNode } from '../dock/dock-node';
import { DockState } from '../dock/dock-state';
import { firstStackOfRole } from '../dock/dock-tree';
import { Tab } from '../tabs/tab';
import { Tabs } from '../tabs/tabs';
import { Workspaces } from '../workspaces/workspaces';
import { FileOpener } from './file-opener';

/**
 * Root listing returned by the fake bridge when a directory is opened.
 */
const ROOT_LISTING: DirectoryListing = {
  path: '/ws',
  name: 'ws',
  entries: [{ name: 'README.md', path: '/ws/README.md', type: 'file' }],
};

/**
 * Holds the next selection the fake bridge's open/openFile calls resolve with; tests mutate it.
 */
let nextSelection: OpenSelection | null;

/**
 * Builds a fake workspace bridge whose open/openFile resolve with {@link nextSelection}.
 */
function fakeBridge(): WorkspaceApi {
  return {
    open: (): Promise<OpenSelection | null> => Promise.resolve(nextSelection),
    openFile: (): Promise<OpenSelection | null> => Promise.resolve(nextSelection),
    openFolder: (): Promise<DirectoryListing | null> => Promise.resolve(null),
    closeFolder: (): Promise<void> => Promise.resolve(),
    readDirectory: (): Promise<DirectoryListing | null> => Promise.resolve(null),
    createFile: () => Promise.resolve({ success: true }),
    createFolder: () => Promise.resolve({ success: true }),
    rename: () => Promise.resolve({ success: true }),
    delete: () => Promise.resolve({ success: true }),
  };
}

describe('FileOpener', () => {
  let opener: FileOpener;
  let tabs: Tabs;
  let workspaces: Workspaces;
  let dockState: DockState;

  /**
   * Returns the panels currently open in the document well.
   */
  function wellPanels(): readonly string[] {
    const well: StackNode | null = firstStackOfRole(dockState.layout(), 'document');
    return well?.panels ?? [];
  }

  beforeEach(() => {
    nextSelection = null;
    (window as unknown as { studio: { workspace: WorkspaceApi } }).studio = {
      workspace: fakeBridge(),
    };
    TestBed.configureTestingModule({});
    opener = TestBed.inject(FileOpener);
    tabs = TestBed.inject(Tabs);
    workspaces = TestBed.inject(Workspaces);
    dockState = TestBed.inject(DockState);
  });

  afterEach(() => {
    delete (window as unknown as { studio?: unknown }).studio;
  });

  it('openInteractive_whenCancelled_opensNothing', async () => {
    nextSelection = null;
    expect(await opener.openInteractive()).toBe(false);
    expect(tabs.tabs()).toHaveLength(0);
  });

  it('openInteractive_whenDirectoryChosen_opensANewWorkspaceTabAndStashesItsFolder', async () => {
    nextSelection = { kind: 'directory', directory: ROOT_LISTING };
    expect(await opener.openInteractive()).toBe(true);
    expect(tabs.tabs().map((tab: Tab): string => tab.type)).toEqual(['directory']);
    expect(workspaces.takeInitial(tabs.tabs()[0].id)).toBe(ROOT_LISTING);
  });

  it('openInteractive_whenSameDirectoryChosenAgain_focusesTheExistingTab', async () => {
    nextSelection = { kind: 'directory', directory: ROOT_LISTING };
    await opener.openInteractive();
    const firstId: string = tabs.tabs()[0].id;
    await opener.openInteractive();
    expect(tabs.tabs()).toHaveLength(1);
    expect(tabs.activeTabId()).toBe(firstId);
  });

  it('openInteractive_whenDifferentDirectoryChosen_opensAnotherWorkspaceTab', async () => {
    nextSelection = { kind: 'directory', directory: ROOT_LISTING };
    await opener.openInteractive();
    nextSelection = {
      kind: 'directory',
      directory: { path: '/other', name: 'other', entries: [] },
    };
    await opener.openInteractive();
    expect(tabs.tabs()).toHaveLength(2);
  });

  it('openInteractive_whenMarkdownChosen_opensMarkdownTab', async () => {
    nextSelection = {
      kind: 'file',
      file: { path: '/ws/notes.md', name: 'notes.md', extension: '.md', content: '# Hello' },
    };
    expect(await opener.openInteractive()).toBe(true);
    expect(tabs.activeTab()?.type).toBe('markdown');
    expect(tabs.activeTab()?.title).toBe('notes.md');
  });

  it('openInteractive_whenOtherTextFileChosen_opensCodeTab', async () => {
    nextSelection = {
      kind: 'file',
      file: { path: '/ws/main.ts', name: 'main.ts', extension: '.ts', content: 'export {};' },
    };
    expect(await opener.openInteractive()).toBe(true);
    expect(tabs.activeTab()?.type).toBe('code');
  });

  it('openInteractive_whenBinaryChosen_opensNothing', async () => {
    nextSelection = { kind: 'binary', path: '/ws/image.png' };
    expect(await opener.openInteractive()).toBe(false);
    expect(tabs.tabs()).toHaveLength(0);
  });

  it('openPath_whenFileOpened_addsADocumentToTheWellNotATab', async () => {
    nextSelection = {
      kind: 'file',
      file: { path: '/ws/main.ts', name: 'main.ts', extension: '.ts', content: 'export {};' },
    };
    expect(await opener.openPath('/ws/main.ts')).toBe(true);
    expect(wellPanels()).toHaveLength(1);
    expect(tabs.tabs()).toHaveLength(0);
  });

  it('openPath_whenFileAlreadyOpen_reusesTheSameDocument', async () => {
    nextSelection = {
      kind: 'file',
      file: { path: '/ws/main.ts', name: 'main.ts', extension: '.ts', content: 'export {};' },
    };
    await opener.openPath('/ws/main.ts');
    await opener.openPath('/ws/main.ts');
    expect(wellPanels()).toHaveLength(1);
  });
});
