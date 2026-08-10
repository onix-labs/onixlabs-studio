import { inject, Service } from '@angular/core';
import {
  BINARY_FILE_OPENER,
  BinaryFileOpener,
} from '@shared/angular/services/file-opener/binary-file-opener';
import { FileInfo, SaveDialogChoice } from '@shared/api/file-channels';
import { DirectoryListing, OpenSelection } from '@shared/api/workspace-channels';
import { Icon } from '@shared/angular/icons/icon';
import { Log } from '@shared/angular/services/log/log';
import { FileSystem } from '@shared/angular/services/file-system/file-system';
import { DocumentPanel } from '../../components/panels/document-panel/document-panel';
import { DockPanelRegistry } from '@shared/angular/services/dock-layout/dock-panel-registry';
import { DockFocus } from '@shared/angular/services/dock-layout/dock-focus';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import {
  findPrimaryStack,
  findStackOfPanel,
  firstStackOfRole,
} from '@shared/angular/services/dock-layout/dock-tree';
import { StackNode } from '@shared/angular/services/dock-layout/dock-node';
import { CodeDocument, Documents } from '@shared/angular/services/documents/documents';
import { RecentItems } from '@shared/angular/services/recent-items/recent-items';
import { Tab, TabType } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { Workspace } from '@shared/angular/services/workspace/workspace';
import { Workspaces } from '../workspaces/workspaces';

/**
 * Holds the lowercased file extensions (including the leading dot) routed to the markdown editor.
 */
const MARKDOWN_EXTENSIONS: ReadonlySet<string> = new Set<string>(['.md', '.markdown']);

/**
 * Routes an opened filesystem selection to the right surface: a directory becomes the workspace,
 * a markdown file opens in a markdown tab, any other text file opens in a code tab, and a file no
 * text editor can open (binary) opens in a binary/hex tab. A cancelled dialog is a no-op. Shared by
 * the welcome screen and the directory tree so both behave identically.
 */
@Service()
export class FileOpener {
  /**
   * Holds the workspace state and the bridge to the open dialogs.
   */
  private readonly workspace: Workspace = inject(Workspace);

  /**
   * Holds the document model that backs code and markdown tabs.
   */
  private readonly documents: Documents = inject(Documents);

  /**
   * Holds the file-system service showing the native confirm-save dialog when a dirty well document is
   * closed.
   */
  private readonly fileSystem: FileSystem = inject(FileSystem);

  /**
   * Holds the editor contributed for files no text editor can open, or null when the binary feature
   * is absent — in which case binary files are skipped, as they were before the editor existed.
   */
  private readonly binaryOpener: BinaryFileOpener | null = inject(BINARY_FILE_OPENER, {
    optional: true,
  });

  /**
   * Holds the top-level tab registry.
   */
  private readonly tabs: Tabs = inject(Tabs);

  /**
   * Holds the dock layout the document well lives in.
   */
  private readonly dockState: DockState = inject(DockState);

  /**
   * Holds the dock focus tracker, so opening a file accents its document well.
   */
  private readonly dockFocus: DockFocus = inject(DockFocus);

  /**
   * Holds the dock panel registry that document panels are registered with.
   */
  private readonly registry: DockPanelRegistry = inject(DockPanelRegistry);

  /**
   * Holds the registry that hands a newly-opened folder to its workspace tab.
   */
  private readonly workspaces: Workspaces = inject(Workspaces);

  /**
   * Holds the recent-items registry, updated whenever a file or folder is opened.
   */
  private readonly recentItems: RecentItems = inject(RecentItems);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Shows the combined open dialog (file or folder) and routes the selection.
   * @returns Returns true when something was opened, or false when cancelled or a binary was chosen.
   */
  public async openInteractive(): Promise<boolean> {
    return this.route(await this.workspace.open());
  }

  /**
   * Opens a file from a workspace's directory tree into that workspace's document well, reusing the
   * panel when the file is already open. The editor is chosen by file type (Milkdown for markdown,
   * Monaco otherwise).
   * @param path The absolute path of the file to open; must be inside the workspace.
   * @returns Returns true when the file was opened, or false when unreadable or binary.
   */
  public async openPath(path: string): Promise<boolean> {
    const selection: OpenSelection | null = await this.workspace.readFile(path);
    if (selection === null || selection.kind === 'directory') {
      return false;
    }
    if (selection.kind === 'binary') {
      return this.openBinary(selection.path);
    }
    this.log.debug('FileOpener', 'Opening file in well', path);
    return this.openInWell(selection.file);
  }

  /**
   * Re-opens a previously-opened file by absolute path as a standalone editor tab, choosing the editor
   * by file type. Unlike {@link openPath}, which opens into a workspace's document well, this opens a
   * top-level tab and so works from the welcome screen at a cold start. The main process honours only
   * paths the user has opened before (or files within an open workspace), so this cannot open arbitrary
   * files.
   * @param path The absolute path of the file to re-open.
   * @returns Returns true when the file was opened, or false when untrusted, unreadable, or binary.
   */
  public async reopenFile(path: string): Promise<boolean> {
    this.log.debug('FileOpener', 'Re-opening file', path);
    return this.route(await this.workspace.reopenFile(path));
  }

  /**
   * Re-opens a previously-opened folder by absolute path as a workspace tab. The main process honours
   * only folders the user has opened before, so this cannot open arbitrary locations; used to re-open a
   * recent folder from the welcome screen.
   * @param path The absolute directory path to re-open.
   * @returns Returns true when the folder was re-opened, or false when untrusted or unreadable.
   */
  public async reopenDirectory(path: string): Promise<boolean> {
    const listing: DirectoryListing | null = await this.workspace.reopenFolder(path);
    if (listing === null) {
      return false;
    }
    this.openDirectory(listing);
    return true;
  }

  /**
   * Opens an arbitrary folder by path as a workspace tab, reusing the existing tab when the folder is
   * already open. Used to open a repository's root as a workspace from the source-control tab.
   * @param path The absolute directory path to open.
   * @returns Returns true when the folder was opened (or already open), or false when unreadable.
   */
  public async openDirectoryPath(path: string): Promise<boolean> {
    const listing: DirectoryListing | null = await this.workspace.readDirectoryListing(path);
    if (listing === null) {
      return false;
    }
    this.openDirectory(listing);
    return true;
  }

  /**
   * Routes an open selection to the workspace or an editor tab.
   * @param selection The selection to route, or null when the dialog was cancelled.
   * @returns Returns true when something was opened; otherwise, false.
   */
  private route(selection: OpenSelection | null): boolean {
    if (selection === null) {
      return false;
    }
    switch (selection.kind) {
      case 'directory':
        this.openDirectory(selection.directory);
        return true;
      case 'file': {
        const type: TabType = this.isMarkdown(selection.file.extension) ? 'markdown' : 'code';
        this.documents.openFileInfo(selection.file, type);
        this.recordRecentFile(selection.file);
        return true;
      }
      case 'binary':
        return this.openBinary(selection.path);
    }
  }

  /**
   * Opens a binary file (one no text editor can open) in a binary/hex tab and records it as a recent
   * item. The document reads its bytes lazily, so opening is cheap however large the file.
   * @param path The absolute path of the binary file to open.
   * @returns Returns true; the binary editor always accepts the file.
   */
  private openBinary(path: string): boolean {
    if (this.binaryOpener === null) {
      return false;
    }
    const tab: Tab = this.binaryOpener.open(path);
    this.recentItems.record(path, tab.title, 'binary');
    this.log.info('FileOpener', `Opened binary file '${tab.title}'`, path);
    return true;
  }

  /**
   * Opens a chosen directory as a new workspace tab, stashing its listing for the tab's view to seed
   * its scoped workspace from. Each opened directory gets its own tab, so several can be open at once.
   * @param listing The root directory listing to display.
   */
  private openDirectory(listing: DirectoryListing): void {
    this.recentItems.record(listing.path, listing.name, 'directory');
    const existing: Tab | undefined = this.tabs.findByResource('directory', listing.path);
    if (existing !== undefined) {
      this.tabs.activate(existing.id);
      this.log.debug('FileOpener', `Reused workspace tab for '${listing.name}'`, existing.id);
      return;
    }
    const tab: Tab = this.tabs.open('directory', listing.path);
    this.tabs.rename(tab.id, listing.name);
    this.workspaces.setInitial(tab.id, listing);
    this.log.info(
      'FileOpener',
      `Opened folder '${listing.name}' as workspace`,
      tab.id,
      listing.path,
    );
  }

  /**
   * Opens a file into the workspace's document well, reusing the panel when it is already open and
   * registering a new document panel otherwise.
   * @param fileInfo The file to open.
   * @returns Returns true when the document well is available and the file was opened.
   */
  private openInWell(fileInfo: FileInfo): boolean {
    const well: StackNode | null = firstStackOfRole(this.dockState.layout(), 'document');
    // With no document well the centre must be a tool-occupied primary slot; a fresh well is split
    // off it (50/50, well on the left). When there is neither a well nor a centre to split, this dock
    // has no document home at all and the caller falls back to opening a full tab.
    const primary: StackNode | null =
      well === null ? findPrimaryStack(this.dockState.layout()) : null;
    if (well === null && primary === null) {
      return false;
    }
    // A file opened into a workspace's document well is not itself a recent item — only the workspace
    // (recorded by openDirectory) is. Recording the file here would surface it on the welcome screen.
    const existing: string | undefined = this.documents.findIdByPath(fileInfo.path);
    if (existing !== undefined && well !== null) {
      this.dockState.setActive(well.id, existing);
      this.dockFocus.focus(well.id);
      return true;
    }
    const id: string = this.documents.createWellDocument(fileInfo);
    const document: CodeDocument | undefined = this.documents.get(id);
    this.registry.register({
      id,
      title: fileInfo.name,
      icon: this.dockIconFor(fileInfo.extension),
      role: 'document',
      component: DocumentPanel,
      // Surface the well document's unsaved state to the dock tab (a dirty marker) and guard its close
      // so an edited-but-unsaved file prompts to save before the tab is removed.
      ...(document === undefined ? {} : { dirty: document.dirty }),
      confirmClose: (): Promise<boolean> => this.confirmCloseWellDocument(id),
    });
    if (well !== null) {
      this.dockState.tabInto(well.id, id);
      this.dockFocus.focus(well.id);
    } else {
      // primary is non-null here (guarded above): split a fresh well off the tool-occupied centre.
      this.dockState.openWellBeside(primary!.id, id);
      const created: StackNode | null = findStackOfPanel(this.dockState.layout(), id);
      if (created !== null) {
        this.dockFocus.focus(created.id);
      }
    }
    return true;
  }

  /**
   * Records an opened file in the recent-items registry, classified as markdown or code by extension.
   * @param fileInfo The file that was opened.
   */
  private recordRecentFile(fileInfo: FileInfo): void {
    this.recentItems.record(
      fileInfo.path,
      fileInfo.name,
      this.isMarkdown(fileInfo.extension) ? 'markdown' : 'code',
    );
  }

  /**
   * Determines whether a file extension routes to the markdown editor.
   * @param extension The file extension, including the leading dot.
   * @returns Returns true when the extension is a markdown extension.
   */
  private isMarkdown(extension: string): boolean {
    return MARKDOWN_EXTENSIONS.has(extension.toLowerCase());
  }

  /**
   * Resolves the dock tab icon for a document by file extension.
   * @param extension The file extension, including the leading dot.
   * @returns Returns the icon for the document.
   */
  /**
   * Resolves a well document's unsaved changes before its tab closes: a clean document closes
   * silently; a dirty one prompts to save / discard / cancel. Returns whether the close may proceed
   * (false — a cancelled prompt or a cancelled save-as — keeps the tab open).
   * @param id The well document's identifier.
   * @returns Returns a promise resolving true to close, or false to keep the tab open.
   */
  private async confirmCloseWellDocument(id: string): Promise<boolean> {
    const document: CodeDocument | undefined = this.documents.get(id);
    if (document?.dirty() !== true) {
      return true;
    }
    const choice: SaveDialogChoice = await this.fileSystem.confirmSave(document.fileName());
    if (choice === 'cancel') {
      this.log.debug('FileOpener', `Close cancelled for dirty '${document.fileName()}'`, id);
      return false;
    }
    if (choice === 'save') {
      return this.documents.save(id);
    }
    return true;
  }

  private dockIconFor(extension: string): Icon {
    return this.isMarkdown(extension) ? Icon.MARKDOWN : Icon.CODE;
  }
}
