import { ChangeDetectionStrategy, Component, inject, input, InputSignal } from '@angular/core';
import { DockPanel } from '../../../services/dock/dock-panel';
import { FileOpener } from '../../../services/file-opener/file-opener';
import { Workspace, WorkspaceTreeNode } from '../../../services/workspace/workspace';
import { Icon } from '../../../icons/icon';
import { AppIcon } from '../../shared/icon/app-icon';

/**
 * Specifies the base left padding of a tree row, in pixels.
 */
const BASE_INDENT: number = 8;

/**
 * Specifies the additional left padding added per depth level, in pixels.
 */
const INDENT_STEP: number = 14;

/**
 * Renders the workspace directory tree as the body of the Solution Explorer dock panel. The dock
 * chrome supplies the panel's title bar, so this component renders only the lazy tree (or the
 * "open a folder" empty state) and delegates all state to the {@link Workspace} service.
 */
@Component({
  selector: 'app-tree-panel',
  imports: [AppIcon],
  templateUrl: './tree-panel.html',
  styleUrl: './tree-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TreePanel {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the dock panel descriptor this body renders. Supplied by the dock outlet, which sets it on
   * every projected panel component; unused here because the dock chrome renders the title.
   */
  public readonly panel: InputSignal<DockPanel> = input.required<DockPanel>();

  /**
   * Gets the workspace service backing the tree.
   */
  public readonly workspace: Workspace = inject(Workspace);

  /**
   * Holds the opener used to open a file into the right editor tab.
   */
  private readonly fileOpener: FileOpener = inject(FileOpener);

  /**
   * Handles a click on a tree row: selects the entry, toggles directories, and opens files into the
   * right editor tab (reusing an existing tab when the file is already open).
   * @param node The node whose row was clicked.
   */
  public onRowClick(node: WorkspaceTreeNode): void {
    this.workspace.select(node.path);
    if (node.type === 'directory') {
      void this.workspace.toggleDirectory(node.path);
    } else {
      void this.fileOpener.openPath(node.path);
    }
  }

  /**
   * Computes the left padding for a row at the given depth.
   * @param depth The row's depth beneath the root.
   * @returns Returns the left padding in pixels.
   */
  public indentFor(depth: number): number {
    return BASE_INDENT + depth * INDENT_STEP;
  }

  /**
   * Resolves the icon for a node, by directory state or file extension.
   * @param node The node to resolve an icon for.
   * @returns Returns the node's icon.
   */
  public iconFor(node: WorkspaceTreeNode): Icon {
    if (node.type === 'directory') {
      return node.expanded ? Icon.FOLDER_OPEN : Icon.FOLDER;
    }
    const extension: string = this.extensionOf(node.name);
    switch (extension) {
      case 'ts':
        return Icon.FILE_TYPESCRIPT;
      case 'js':
      case 'mjs':
      case 'cjs':
        return Icon.FILE_JAVASCRIPT;
      case 'json':
        return Icon.FILE_JSON;
      case 'md':
        return Icon.FILE_MARKDOWN;
      case 'scss':
      case 'css':
        return Icon.FILE_STYLESHEET;
      case 'html':
        return Icon.FILE_HTML;
      default:
        return node.name.startsWith('.') ? Icon.FILE_HIDDEN : Icon.FILE;
    }
  }

  /**
   * Extracts a file's lowercased extension, without the leading dot.
   * @param name The file name.
   * @returns Returns the extension, or an empty string when there is none.
   */
  private extensionOf(name: string): string {
    const dot: number = name.lastIndexOf('.');
    return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
  }
}
