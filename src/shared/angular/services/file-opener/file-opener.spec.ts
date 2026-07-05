import { TestBed } from '@angular/core/testing';
import { Bridge } from '@shared/api/bridge';
import { DirectoryListing, OpenSelection, WorkspaceChannel } from '@shared/api/workspace-channels';
import { StackNode } from '@shared/angular/services/dock/dock-node';
import { DockState } from '@shared/angular/services/dock/dock-state';
import { firstStackOfRole } from '@shared/angular/services/dock/dock-tree';
import { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
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
 * Holds the next listing the fake bridge's reopen-folder call resolves with; tests mutate it.
 */
let nextListing: DirectoryListing | null;

/**
 * Builds a fake transport whose open/open-file/reopen-file channels resolve with
 * {@link nextSelection} and whose reopen-folder channel resolves with {@link nextListing}.
 */
function fakeBridge(): Bridge {
  return {
    invoke: <T>(channel: string): Promise<T> => {
      if (
        channel === (WorkspaceChannel.Open as string) ||
        channel === (WorkspaceChannel.OpenFile as string) ||
        channel === (WorkspaceChannel.ReopenFile as string)
      ) {
        return Promise.resolve(nextSelection as T);
      }
      if (channel === (WorkspaceChannel.ReopenFolder as string)) {
        return Promise.resolve(nextListing as T);
      }
      return Promise.resolve(null as T);
    },
    send: (): void => undefined,
    on: (): (() => void) => (): void => undefined,
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
    nextListing = null;
    (window as unknown as { bridge: Bridge }).bridge = fakeBridge();
    TestBed.configureTestingModule({});
    opener = TestBed.inject(FileOpener);
    tabs = TestBed.inject(Tabs);
    workspaces = TestBed.inject(Workspaces);
    dockState = TestBed.inject(DockState);
  });

  afterEach(() => {
    delete (window as unknown as { bridge?: unknown }).bridge;
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

  it('openInteractive_whenBinaryChosen_opensABinaryTab', async () => {
    nextSelection = { kind: 'binary', path: '/ws/image.png' };
    expect(await opener.openInteractive()).toBe(true);
    expect(tabs.activeTab()?.type).toBe('binary');
    expect(tabs.activeTab()?.title).toBe('image.png');
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

  it('reopenFile_whenTrustedFile_opensATopLevelTabNotAWellDocument', async () => {
    nextSelection = {
      kind: 'file',
      file: { path: '/recent/main.ts', name: 'main.ts', extension: '.ts', content: 'export {};' },
    };
    expect(await opener.reopenFile('/recent/main.ts')).toBe(true);
    expect(tabs.activeTab()?.type).toBe('code');
    expect(wellPanels()).toHaveLength(0);
  });

  it('reopenFile_whenUntrusted_opensNothing', async () => {
    nextSelection = null;
    expect(await opener.reopenFile('/blocked/secret.ts')).toBe(false);
    expect(tabs.tabs()).toHaveLength(0);
  });

  it('reopenDirectory_whenTrustedFolder_opensAWorkspaceTab', async () => {
    nextListing = ROOT_LISTING;
    expect(await opener.reopenDirectory('/ws')).toBe(true);
    expect(tabs.tabs().map((tab: Tab): string => tab.type)).toEqual(['directory']);
    expect(workspaces.takeInitial(tabs.tabs()[0].id)).toBe(ROOT_LISTING);
  });

  it('reopenDirectory_whenUntrusted_opensNothing', async () => {
    nextListing = null;
    expect(await opener.reopenDirectory('/blocked')).toBe(false);
    expect(tabs.tabs()).toHaveLength(0);
  });
});
