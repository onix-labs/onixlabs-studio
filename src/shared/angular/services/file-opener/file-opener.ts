import { effect, inject, Service } from '@angular/core';
import {
  BINARY_FILE_OPENER,
  BinaryFileOpener,
} from '@shared/angular/services/file-opener/binary-file-opener';
import {
  IMAGE_FILE_OPENER,
  ImageFileOpener,
} from '@shared/angular/services/file-opener/image-file-opener';
import { isApiDocumentName } from '@shared/api/api-client-types';
import { ApiFiles } from '@shared/angular/services/api-files/api-files';
import { FileInfo, SaveDialogChoice } from '@shared/api/file-channels';
import { DirectoryListing, OpenSelection } from '@shared/api/workspace-channels';
import { Icon } from '@shared/angular/icons/icon';
import { Log } from '@shared/angular/services/log/log';
import { FileSystem } from '@shared/angular/services/file-system/file-system';
import { DocumentPanel } from '../../components/panels/document-panel/document-panel';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { DockPanelRegistry } from '@shared/angular/services/dock-layout/dock-panel-registry';
import { DockFocus } from '@shared/angular/services/dock-layout/dock-focus';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import { DockTabContext } from '@shared/angular/services/dock-layout/dock-tab-context';
import {
  collectPanelIds,
  findPrimaryStack,
  findStackOfPanel,
  firstStackOfRole,
} from '@shared/angular/services/dock-layout/dock-tree';
import { DockNode, StackNode } from '@shared/angular/services/dock-layout/dock-node';
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
 * Routes an opened filesystem selection to the right surface: a directory becomes the workspace, an
 * API document (`*.api.json`) opens in an API Explorer tab, a markdown file opens in a markdown tab,
 * any other text file opens in a code tab, an image opens in the image viewer, and a file no text
 * editor can open (binary) opens in a binary/hex tab. A cancelled dialog is a no-op. Shared by the
 * welcome screen and the directory tree so both behave identically.
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
   * Holds the viewer contributed for images, or null when the image feature is absent — in which case
   * an image opens in the binary editor, as it did before the viewer existed.
   */
  private readonly imageOpener: ImageFileOpener | null = inject(IMAGE_FILE_OPENER, {
    optional: true,
  });

  /**
   * Holds the context of the tab this opener serves: a workspace tab's id when the opener is the one
   * its view provides, or an empty id for the application-wide opener, which has no well of its own.
   */
  private readonly tabContext: DockTabContext = inject(DockTabContext);

  /**
   * Holds the ids of the image panels this opener placed in its well, so each one's hold on its
   * document is released once the panel has actually left the layout — a panel that is only split
   * or moved stays in the layout, and keeps its document.
   */
  private readonly imagePanels: Set<string> = new Set<string>();

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
   * Holds the registry that hands a newly-opened API document to its API Explorer tab.
   */
  private readonly apiFiles: ApiFiles = inject(ApiFiles);

  /**
   * Holds the recent-items registry, updated whenever a file or folder is opened.
   */
  private readonly recentItems: RecentItems = inject(RecentItems);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Initializes a new instance of the {@link FileOpener} class, wiring the release of each image
   * panel's document once the panel is closed.
   */
  public constructor() {
    effect((): void => {
      const present: ReadonlySet<string> = new Set<string>(
        collectPanelIds(this.dockState.layout()),
      );
      for (const id of [...this.imagePanels]) {
        if (!present.has(id)) {
          this.imagePanels.delete(id);
          this.imageOpener?.releaseWellPanel(id);
        }
      }
    });
  }

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
    // An image is document-shaped, unlike a binary: it sits in the well beside the code that
    // references it, falling back to its own tab only when this dock has no document home.
    if (selection.kind === 'image') {
      return this.openImageInWell(selection.path) || this.openImage(selection.path);
    }
    // An API document is a whole surface rather than a document in this workspace's well, so it opens
    // as its own tab — as a binary file does — instead of being edited as text beside the code.
    if (this.openApiDocument(selection.file)) {
      return true;
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
        if (this.openApiDocument(selection.file)) {
          return true;
        }
        const type: TabType = this.isMarkdown(selection.file.extension) ? 'markdown' : 'code';
        this.documents.openFileInfo(selection.file, type);
        this.recordRecentFile(selection.file);
        return true;
      }
      case 'image':
        return this.openImage(selection.path);
      case 'binary':
        return this.openBinary(selection.path);
    }
  }

  /**
   * Opens a file in the binary/hex editor whatever its type, so a file routed elsewhere by default —
   * an image — can still be inspected byte by byte.
   * @param path The absolute path of the file to open.
   * @returns Returns true when the binary editor accepted the file; false when it is absent.
   */
  public openAsBinary(path: string): boolean {
    return this.openBinary(path);
  }

  /**
   * Opens a file as text in the code editor whatever its type, so a file routed elsewhere by default
   * — an SVG, which opens in the image viewer — can have its source edited. Inside a workspace it
   * opens in the well; elsewhere, in its own code tab.
   * @param path The absolute path of the file to open.
   * @returns Returns true when the file was read and opened; false when it could not be read.
   */
  public async openAsText(path: string): Promise<boolean> {
    const fileInfo: FileInfo | null = await this.fileSystem.read(path);
    if (fileInfo === null) {
      this.log.warn('FileOpener', 'Could not read file to open as text', path);
      return false;
    }
    if (this.isWorkspace() && this.openInWell(fileInfo)) {
      return true;
    }
    this.documents.openFileInfo(fileInfo, 'code');
    this.recentItems.record(fileInfo.path, fileInfo.name, 'code');
    return true;
  }

  /**
   * Opens a file that claims to be an API document in an API Explorer tab. Only the name is consulted
   * here; the document itself is verified by {@link ApiFiles}, which declines a `*.api.json` that is
   * not one — so a malformed or foreign file falls through to the text editor rather than being
   * loaded as a workspace.
   * @param fileInfo The file to open.
   * @returns Returns true when the file was opened as an API document; otherwise, false.
   */
  private openApiDocument(fileInfo: FileInfo): boolean {
    return isApiDocumentName(fileInfo.name) && this.apiFiles.open(fileInfo);
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
   * Opens an image in its own top-level image tab and records it as a recent item. Without the image
   * feature, the image opens in the binary editor instead.
   * @param path The absolute path of the image to open.
   * @returns Returns true when the image was opened.
   */
  private openImage(path: string): boolean {
    if (this.imageOpener === null) {
      return this.openBinary(path);
    }
    const tab: Tab = this.imageOpener.open(path);
    this.recentItems.record(path, tab.title, 'image');
    this.log.info('FileOpener', `Opened image '${tab.title}'`, path);
    return true;
  }

  /**
   * Opens an image into this workspace's document well, reusing its panel when the image is already
   * open there. Like any file opened into a well, it is not recorded as a recent item.
   * @param path The absolute path of the image to open.
   * @returns Returns true when the image was placed in the well; false when this opener serves no
   * workspace, the image feature is absent, or the dock has no document home.
   */
  private openImageInWell(path: string): boolean {
    if (this.imageOpener === null || !this.isWorkspace()) {
      return false;
    }
    const panel: DockPanel = this.imageOpener.wellPanel(path, this.tabContext.tabId());
    if (!this.placeInWell(panel)) {
      this.imageOpener.releaseWellPanel(panel.id);
      return false;
    }
    this.imagePanels.add(panel.id);
    this.log.debug('FileOpener', 'Opened image in well', path);
    return true;
  }

  /**
   * Determines whether this opener serves a workspace tab (and so has a document well of its own),
   * rather than being the application-wide opener used by the welcome screen.
   * @returns Returns true when the opener belongs to a workspace tab.
   */
  private isWorkspace(): boolean {
    return this.tabContext.tabId() !== '';
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
    if (!this.hasDocumentHome()) {
      return false;
    }
    // A file opened into a workspace's document well is not itself a recent item — only the workspace
    // (recorded by openDirectory) is. Recording the file here would surface it on the welcome screen.
    const existing: string | undefined = this.documents.findIdByPath(fileInfo.path);
    if (existing !== undefined && this.activateInWell(existing)) {
      return true;
    }
    const id: string = this.documents.createWellDocument(fileInfo);
    const document: CodeDocument | undefined = this.documents.get(id);
    return this.placeInWell({
      id,
      title: fileInfo.name,
      icon: this.dockIconFor(fileInfo.extension),
      role: 'document',
      component: DocumentPanel,
      // A markdown well panel mounts its own formatting toolstrip, so the dock's stub strip (whose
      // actions are placeholders) is suppressed for it; code documents keep the shared strip.
      ownsToolStrip: this.isMarkdown(fileInfo.extension),
      // Surface the well document's unsaved state to the dock tab (a dirty marker) and guard its close
      // so an edited-but-unsaved file prompts to save before the tab is removed.
      ...(document === undefined ? {} : { dirty: document.dirty }),
      confirmClose: (): Promise<boolean> => this.confirmCloseWellDocument(id),
    });
  }

  /**
   * Determines whether this dock has somewhere to put a document: a well, or failing that a
   * tool-occupied centre a fresh well can be split off.
   * @returns Returns true when a document can be placed.
   */
  private hasDocumentHome(): boolean {
    const layout: DockNode = this.dockState.layout();
    return firstStackOfRole(layout, 'document') !== null || findPrimaryStack(layout) !== null;
  }

  /**
   * Activates a panel that is already in the document well.
   * @param id The panel's identifier.
   * @returns Returns true when the panel was found in a well and activated.
   */
  private activateInWell(id: string): boolean {
    const stack: StackNode | null = findStackOfPanel(this.dockState.layout(), id);
    if (stack?.role !== 'document') {
      return false;
    }
    this.dockState.setActive(stack.id, id);
    this.dockFocus.focus(stack.id);
    return true;
  }

  /**
   * Places a document panel in the well — re-activating it when it is already there — registering
   * it with the dock first. With no well, a fresh one is split off the tool-occupied centre (50/50,
   * well on the left).
   * @param panel The document panel to place.
   * @returns Returns true when the panel was placed; false when this dock has no document home, in
   * which case the caller falls back to opening a full tab.
   */
  private placeInWell(panel: DockPanel): boolean {
    if (this.activateInWell(panel.id)) {
      return true;
    }
    const well: StackNode | null = firstStackOfRole(this.dockState.layout(), 'document');
    const primary: StackNode | null =
      well === null ? findPrimaryStack(this.dockState.layout()) : null;
    if (well === null && primary === null) {
      return false;
    }
    this.registry.register(panel);
    if (well !== null) {
      this.dockState.tabInto(well.id, panel.id);
      this.dockFocus.focus(well.id);
    } else {
      // primary is non-null here (guarded above): split a fresh well off the tool-occupied centre.
      this.dockState.openWellBeside(primary!.id, panel.id);
      const created: StackNode | null = findStackOfPanel(this.dockState.layout(), panel.id);
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
