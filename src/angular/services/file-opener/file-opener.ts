import { inject, Service } from '@angular/core';
import { DirectoryListing, OpenSelection } from '../../../shared/studio-api';
import { Documents } from '../documents/documents';
import { Output } from '../output/output';
import { Tab, TabType } from '../tabs/tab';
import { Tabs } from '../tabs/tabs';
import { Workspace } from '../workspace/workspace';

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
   * Shows the combined open dialog (file or folder) and routes the selection.
   * @returns Returns true when something was opened, or false when cancelled or a binary was chosen.
   */
  public async openInteractive(): Promise<boolean> {
    return this.route(await this.workspace.open());
  }

  /**
   * Opens a known file path (for example, from the directory tree) into the right editor tab.
   * @param path The absolute path of the file to open; must be inside the workspace.
   * @returns Returns true when the file was opened, or false when unreadable or binary.
   */
  public async openPath(path: string): Promise<boolean> {
    return this.route(await this.workspace.readFile(path));
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
   * Shows a chosen directory in the workspace: activates the directory tab (opening one if needed)
   * and seeds the tree from the listing.
   * @param listing The root directory listing to display.
   */
  private openDirectory(listing: DirectoryListing): void {
    const existing: Tab | undefined = this.tabs
      .tabs()
      .find((tab: Tab): boolean => tab.type === 'directory');
    if (existing !== undefined) {
      this.tabs.activate(existing.id);
    } else {
      this.tabs.open('directory');
    }
    this.workspace.openListing(listing);
  }

  /**
   * Determines whether a file extension routes to the markdown editor.
   * @param extension The file extension, including the leading dot.
   * @returns Returns true when the extension is a markdown extension.
   */
  private isMarkdown(extension: string): boolean {
    return MARKDOWN_EXTENSIONS.has(extension.toLowerCase());
  }
}
