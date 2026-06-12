import { ChangeDetectionStrategy, Component, inject, input, InputSignal } from '@angular/core';
import { DockPanel } from '../../../services/dock/dock-panel';
import { Workspace, WorkspaceTreeNode } from '../../../services/workspace/workspace';

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
  imports: [],
  templateUrl: './tree-panel.html',
  styleUrl: './tree-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TreePanel {
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
   * Handles a click on a tree row: selects the entry and toggles directories.
   * @param node The node whose row was clicked.
   */
  public onRowClick(node: WorkspaceTreeNode): void {
    this.workspace.select(node.path);
    if (node.type === 'directory') {
      void this.workspace.toggleDirectory(node.path);
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
   * Resolves the Tabler icon class for a node, by directory state or file extension.
   * @param node The node to resolve an icon for.
   * @returns Returns the icon class (without the leading `ti` base class).
   */
  public iconFor(node: WorkspaceTreeNode): string {
    if (node.type === 'directory') {
      return node.expanded ? 'ti-folder-open' : 'ti-folder';
    }
    const extension: string = this.extensionOf(node.name);
    switch (extension) {
      case 'ts':
        return 'ti-brand-typescript';
      case 'js':
      case 'mjs':
      case 'cjs':
        return 'ti-brand-javascript';
      case 'json':
        return 'ti-json';
      case 'md':
        return 'ti-markdown';
      case 'scss':
      case 'css':
        return 'ti-brand-css3';
      case 'html':
        return 'ti-brand-html5';
      default:
        return node.name.startsWith('.') ? 'ti-file-dots' : 'ti-file';
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
