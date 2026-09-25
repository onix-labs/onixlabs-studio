import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { API_DOCUMENT_KIND } from '@shared/api/api-client-types';
import { Bridge } from '@shared/api/bridge';
import { FileChannel, FileInfo } from '@shared/api/file-channels';
import { DirectoryListing, OpenSelection, WorkspaceChannel } from '@shared/api/workspace-channels';
import { StackNode } from '@shared/angular/services/dock-layout/dock-node';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import { DockTabContext } from '@shared/angular/services/dock-layout/dock-tab-context';
import {
  findPrimaryStack,
  findStackOfPanel,
  firstStackOfRole,
} from '@shared/angular/services/dock-layout/dock-tree';
import { Icon } from '@shared/angular/icons/icon';
import { RecentItem, RecentItems } from '@shared/angular/services/recent-items/recent-items';
import { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { Workspaces } from '../workspaces/workspaces';
import { BINARY_FILE_OPENER, BinaryFileOpener } from './binary-file-opener';
import { IMAGE_FILE_OPENER, ImageFileOpener } from './image-file-opener';
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
 * A minimal API document, as it is written on disk.
 */
const API_DOCUMENT_TEXT: string = JSON.stringify({
  kind: API_DOCUMENT_KIND,
  version: 1,
  folders: [],
  requests: [],
  environments: [],
  activeEnvironmentId: null,
});

/**
 * Holds the next selection the fake bridge's open/openFile calls resolve with; tests mutate it.
 */
let nextSelection: OpenSelection | null;

/**
 * Holds the next listing the fake bridge's reopen-folder call resolves with; tests mutate it.
 */
let nextListing: DirectoryListing | null;

/**
 * Holds the file the fake bridge's file-read call resolves with; tests mutate it.
 */
let nextFileInfo: FileInfo | null;

/**
 * Stands in for the image feature's well panel component.
 */
@Component({ selector: 'app-fake-image-panel', template: '' })
class FakeImagePanel {}

/**
 * Records what the fake image opener was asked to do.
 */
interface ImageOpenerCalls {
  /**
   * Gets the paths opened as tabs.
   */
  readonly tabs: string[];

  /**
   * Gets the well panels released.
   */
  readonly released: string[];
}

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
      if (channel === (FileChannel.Read as string)) {
        return Promise.resolve(nextFileInfo as T);
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
  let imageCalls: ImageOpenerCalls;

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
    nextFileInfo = null;
    imageCalls = { tabs: [], released: [] };
    (window as unknown as { bridge: Bridge }).bridge = fakeBridge();
    TestBed.configureTestingModule({
      providers: [
        // A stand-in for the binary feature's contributed opener: opens a plain binary tab titled
        // with the file's base name, mirroring the real BinaryDocuments contract.
        {
          provide: BINARY_FILE_OPENER,
          useFactory: (): BinaryFileOpener => {
            const tabRegistry: Tabs = inject(Tabs);
            return {
              open: (path: string): Tab => {
                const tab: Tab = tabRegistry.open('binary', path);
                tabRegistry.rename(tab.id, path.split('/').pop() ?? path);
                tabRegistry.activate(tab.id);
                return tabRegistry.get(tab.id) ?? tab;
              },
            };
          },
        },
        // A stand-in for the image feature's contributed opener: an image tab titled with the file's
        // base name, and a well panel whose release is recorded.
        {
          provide: IMAGE_FILE_OPENER,
          useFactory: (): ImageFileOpener => {
            const tabRegistry: Tabs = inject(Tabs);
            return {
              open: (path: string): Tab => {
                imageCalls.tabs.push(path);
                const tab: Tab = tabRegistry.open('image', path);
                tabRegistry.rename(tab.id, path.split('/').pop() ?? path);
                tabRegistry.activate(tab.id);
                return tabRegistry.get(tab.id) ?? tab;
              },
              wellPanel: (path: string, ownerTabId: string): DockPanel => ({
                id: `image-well:${ownerTabId}:${path}`,
                title: path.split('/').pop() ?? path,
                icon: Icon.IMAGE_FILE,
                role: 'document',
                component: FakeImagePanel,
              }),
              releaseWellPanel: (panelId: string): void => void imageCalls.released.push(panelId),
            };
          },
        },
      ],
    });
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

  it('openInteractive_whenApiDocumentChosen_opensAnApiExplorerTab', async () => {
    nextSelection = {
      kind: 'file',
      file: {
        path: '/ws/orders.api.json',
        name: 'orders.api.json',
        extension: '.json',
        content: API_DOCUMENT_TEXT,
      },
    };
    expect(await opener.openInteractive()).toBe(true);
    expect(tabs.activeTab()?.type).toBe('api-explorer');
    expect(tabs.activeTab()?.title).toBe('orders.api.json');
  });

  it('openInteractive_whenApiDocumentIsNotOne_fallsThroughToTheCodeEditor', async () => {
    // A file named like ours but holding someone else's JSON belongs in the text editor, where it can
    // be looked at and fixed, rather than being loaded as a workspace.
    nextSelection = {
      kind: 'file',
      file: {
        path: '/ws/other.api.json',
        name: 'other.api.json',
        extension: '.json',
        content: '{ "openapi": "3.0.0" }',
      },
    };
    expect(await opener.openInteractive()).toBe(true);
    expect(tabs.activeTab()?.type).toBe('code');
  });

  it('openPath_whenApiDocumentOpened_opensATabRatherThanAWellDocument', async () => {
    nextSelection = {
      kind: 'file',
      file: {
        path: '/ws/orders.api.json',
        name: 'orders.api.json',
        extension: '.json',
        content: API_DOCUMENT_TEXT,
      },
    };
    expect(await opener.openPath('/ws/orders.api.json')).toBe(true);
    expect(wellPanels()).toHaveLength(0);
    expect(tabs.activeTab()?.type).toBe('api-explorer');
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

  it('openPath_whenCentreIsToolOccupied_splitsAFreshWellForTheDocument', async () => {
    // Occupy the empty centre with a tool, leaving no document well at all.
    const centre: StackNode | null = findPrimaryStack(dockState.layout());
    expect(centre).not.toBeNull();
    dockState.occupyWell(centre!.id, 'agent');
    expect(firstStackOfRole(dockState.layout(), 'document')).toBeNull();

    nextSelection = {
      kind: 'file',
      file: { path: '/ws/main.ts', name: 'main.ts', extension: '.ts', content: 'export {};' },
    };
    expect(await opener.openPath('/ws/main.ts')).toBe(true);

    // A fresh well now holds the document, and the tool still lives alongside it (not swallowed).
    expect(wellPanels()).toHaveLength(1);
    expect(findStackOfPanel(dockState.layout(), 'agent')).not.toBeNull();
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

  it('openInteractive_whenImageChosen_opensAnImageTabAndRecordsIt', async () => {
    nextSelection = { kind: 'image', path: '/pictures/photo.png' };
    expect(await opener.openInteractive()).toBe(true);
    expect(tabs.activeTab()?.type).toBe('image');
    expect(imageCalls.tabs).toEqual(['/pictures/photo.png']);
    const recent: RecentItem | undefined = TestBed.inject(RecentItems).items()[0];
    expect(recent?.kind).toBe('image');
    expect(recent?.path).toBe('/pictures/photo.png');
  });

  it('openPath_whenImageOpenedInAWorkspace_placesItInTheWellNotATab', async () => {
    TestBed.inject(DockTabContext).setTabId('ws-tab');
    nextSelection = { kind: 'image', path: '/ws/logo.svg' };
    expect(await opener.openPath('/ws/logo.svg')).toBe(true);
    expect(wellPanels()).toEqual(['image-well:ws-tab:/ws/logo.svg']);
    expect(tabs.tabs()).toHaveLength(0);
  });

  it('openPath_whenImageAlreadyInTheWell_reusesItsPanel', async () => {
    TestBed.inject(DockTabContext).setTabId('ws-tab');
    nextSelection = { kind: 'image', path: '/ws/logo.svg' };
    await opener.openPath('/ws/logo.svg');
    await opener.openPath('/ws/logo.svg');
    expect(wellPanels()).toHaveLength(1);
  });

  it('openPath_whenImagePanelClosed_releasesItsDocument', async () => {
    TestBed.inject(DockTabContext).setTabId('ws-tab');
    nextSelection = { kind: 'image', path: '/ws/logo.svg' };
    await opener.openPath('/ws/logo.svg');
    TestBed.tick();
    expect(imageCalls.released).toEqual([]);

    dockState.removeFromLayout('image-well:ws-tab:/ws/logo.svg');
    TestBed.tick();

    expect(imageCalls.released).toEqual(['image-well:ws-tab:/ws/logo.svg']);
  });

  it('openPath_whenImageOpenedOutsideAWorkspace_fallsBackToATab', async () => {
    nextSelection = { kind: 'image', path: '/ws/logo.png' };
    expect(await opener.openPath('/ws/logo.png')).toBe(true);
    expect(tabs.activeTab()?.type).toBe('image');
    expect(wellPanels()).toHaveLength(0);
  });

  it('openAsBinary_opensTheFileInTheBinaryEditorWhateverItsType', () => {
    expect(opener.openAsBinary('/ws/logo.png')).toBe(true);
    expect(tabs.activeTab()?.type).toBe('binary');
  });

  it('openAsText_outsideAWorkspace_opensACodeTab', async () => {
    nextFileInfo = { path: '/ws/logo.svg', name: 'logo.svg', extension: '.svg', content: '<svg/>' };
    expect(await opener.openAsText('/ws/logo.svg')).toBe(true);
    expect(tabs.activeTab()?.type).toBe('code');
    expect(wellPanels()).toHaveLength(0);
  });

  it('openAsText_insideAWorkspace_opensTheSourceInTheWell', async () => {
    TestBed.inject(DockTabContext).setTabId('ws-tab');
    nextFileInfo = { path: '/ws/logo.svg', name: 'logo.svg', extension: '.svg', content: '<svg/>' };
    expect(await opener.openAsText('/ws/logo.svg')).toBe(true);
    expect(wellPanels()).toHaveLength(1);
    expect(tabs.tabs()).toHaveLength(0);
  });

  it('openAsText_whenUnreadable_opensNothing', async () => {
    nextFileInfo = null;
    expect(await opener.openAsText('/ws/missing.svg')).toBe(false);
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

describe('FileOpener without the image feature', () => {
  afterEach(() => {
    delete (window as unknown as { bridge?: unknown }).bridge;
  });

  it('openInteractive_whenImageChosen_fallsBackToTheBinaryEditor', async () => {
    nextSelection = { kind: 'image', path: '/pictures/photo.png' };
    (window as unknown as { bridge: Bridge }).bridge = fakeBridge();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: BINARY_FILE_OPENER,
          useFactory: (): BinaryFileOpener => {
            const tabRegistry: Tabs = inject(Tabs);
            return { open: (path: string): Tab => tabRegistry.open('binary', path) };
          },
        },
      ],
    });
    const opener: FileOpener = TestBed.inject(FileOpener);

    expect(await opener.openInteractive()).toBe(true);
    expect(TestBed.inject(Tabs).activeTab()?.type).toBe('binary');
  });
});
