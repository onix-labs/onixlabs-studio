import { inject, Service } from '@angular/core';
import { DirectoryListing, FileInfo, OpenSelection } from '../../../shared/studio-api';
import { Icon } from '../../icons/icon';
import { DocumentPanel } from '../../components/panels/document-panel/document-panel';
import { DockPanelRegistry } from '../dock/dock-panel-registry';
import { DockFocus } from '../dock/dock-focus';
import { DockState } from '../dock/dock-state';
import { firstStackOfRole } from '../dock/dock-tree';
import { StackNode } from '../dock/dock-node';
import { Documents } from '../documents/documents';
import { Output } from '../output/output';
import { Tab, TabType } from '../tabs/tab';
import { Tabs } from '../tabs/tabs';
import { Workspace } from '../workspace/workspace';
import { Workspaces } from '../workspaces/workspaces';

/**
 * Holds the lowercased file extensions (including the leading dot) routed to the markdown editor.
 */
const MARKDOWN_EXTENSIONS: ReadonlySet<string> = new Set<string>(['.md', '.markdown']);

/**
 * Routes an opened filesystem selection to the right surface: a directory becomes the workspace,
 * a markdown file opens in a markdown tab, and any other text file opens in a code tab. Binary
 * files are recognised but not opened, and a cancelled dialog is a no-op. Shared by the welcome
 * screen and the directory tree so both behave identically.
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
   * Holds the top-level tab registry.
   */
  private readonly tabs: Tabs = inject(Tabs);

  /**
   * Holds the shared output channel that records what was opened.
   */
  private readonly output: Output = inject(Output);

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
      this.output.appendLine(`Skipped binary file ${selection.path}`);
      return false;
    }
    return this.openInWell(selection.file);
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
    this.output.appendLine(`Opened folder ${listing.path}`);
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
        this.output.appendLine(`Opened folder ${selection.directory.path}`);
        return true;
      case 'file': {
        const type: TabType = this.isMarkdown(selection.file.extension) ? 'markdown' : 'code';
        this.documents.openFileInfo(selection.file, type);
        this.output.appendLine(`Opened ${selection.file.path}`);
        return true;
      }
      case 'binary':
        this.output.appendLine(`Skipped binary file ${selection.path}`);
        return false;
    }
  }

  /**
   * Opens a chosen directory as a new workspace tab, stashing its listing for the tab's view to seed
   * its scoped workspace from. Each opened directory gets its own tab, so several can be open at once.
   * @param listing The root directory listing to display.
   */
  private openDirectory(listing: DirectoryListing): void {
    const existing: Tab | undefined = this.tabs.findByResource('directory', listing.path);
    if (existing !== undefined) {
      this.tabs.activate(existing.id);
      return;
    }
    const tab: Tab = this.tabs.open('directory', listing.path);
    this.tabs.rename(tab.id, listing.name);
    this.workspaces.setInitial(tab.id, listing);
  }

  /**
   * Opens a file into the workspace's document well, reusing the panel when it is already open and
   * registering a new document panel otherwise.
   * @param fileInfo The file to open.
   * @returns Returns true when the document well is available and the file was opened.
   */
  private openInWell(fileInfo: FileInfo): boolean {
    const well: StackNode | null = firstStackOfRole(this.dockState.layout(), 'document');
    if (well === null) {
      return false;
    }
    const existing: string | undefined = this.documents.findIdByPath(fileInfo.path);
    if (existing !== undefined) {
      this.dockState.setActive(well.id, existing);
      this.dockFocus.focus(well.id);
      return true;
    }
    const id: string = this.documents.createWellDocument(fileInfo);
    this.registry.register({
      id,
      title: fileInfo.name,
      icon: this.dockIconFor(fileInfo.extension),
      role: 'document',
      component: DocumentPanel,
    });
    this.dockState.tabInto(well.id, id);
    this.dockFocus.focus(well.id);
    this.output.appendLine(`Opened ${fileInfo.path}`);
    return true;
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
  private dockIconFor(extension: string): Icon {
    return this.isMarkdown(extension) ? Icon.MARKDOWN : Icon.CODE;
  }
}
