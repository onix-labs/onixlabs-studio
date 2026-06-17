import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { ProjectModel, ProjectNode } from '../../../../shared/project-system';
import { DockPanel } from '../../../services/dock/dock-panel';
import { FileOpener } from '../../../services/file-opener/file-opener';
import { SolutionModel } from '../../../services/project/solution-model';
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
 * A flattened solution-tree row: a node and its depth, so the nested model renders as an indented list.
 */
interface SolutionRow {
  /**
   * Holds the node the row renders.
   */
  readonly node: ProjectNode;

  /**
   * Holds the node's depth beneath the solution root.
   */
  readonly depth: number;
}

/**
 * Renders the logical solution model (solution folders and projects) as the body of the Solution
 * Explorer dock panel — distinct from the File Explorer's filesystem tree. The model is supplied by the
 * tab-scoped {@link SolutionModel}; clicking a project opens its project file.
 */
@Component({
  selector: 'app-solution-panel',
  imports: [AppIcon],
  templateUrl: './solution-panel.html',
  styleUrl: './solution-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SolutionPanel {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the dock panel descriptor this body renders. Supplied by the dock outlet; unused here because
   * the dock chrome renders the title.
   */
  public readonly panel: InputSignal<DockPanel> = input.required<DockPanel>();

  /**
   * Holds the tab-scoped solution model the panel renders.
   */
  private readonly solution: SolutionModel = inject(SolutionModel);

  /**
   * Holds the opener used to open a project file into an editor tab.
   */
  private readonly fileOpener: FileOpener = inject(FileOpener);

  /**
   * Gets the current solution model, or null when there is none.
   */
  public readonly model: Signal<ProjectModel | null> = this.solution.model;

  /**
   * Gets the flattened, indented rows of the solution tree.
   */
  public readonly rows: Signal<readonly SolutionRow[]> = computed((): readonly SolutionRow[] => {
    const model: ProjectModel | null = this.solution.model();
    return model === null ? [] : this.flatten(model.tree, 0);
  });

  /**
   * Computes the left padding for a row at the given depth.
   * @param depth The row's depth beneath the solution root.
   * @returns Returns the left padding in pixels.
   */
  public indentFor(depth: number): number {
    return BASE_INDENT + depth * INDENT_STEP;
  }

  /**
   * Resolves the icon for a node.
   * @param node The node to resolve an icon for.
   * @returns Returns the node's icon.
   */
  public iconFor(node: ProjectNode): Icon {
    return node.type === 'folder' ? Icon.DIRECTORY : Icon.FILE;
  }

  /**
   * Handles a click on a row: opens a project's file; folders do nothing.
   * @param node The node whose row was clicked.
   */
  public onRowClick(node: ProjectNode): void {
    if (node.type === 'project') {
      void this.fileOpener.openPath(node.path);
    }
  }

  /**
   * Flattens the nested tree into indented rows, in tree order.
   * @param nodes The nodes to flatten.
   * @param depth The depth of the given nodes.
   * @returns Returns the rows.
   */
  private flatten(nodes: readonly ProjectNode[], depth: number): SolutionRow[] {
    const rows: SolutionRow[] = [];
    for (const node of nodes) {
      rows.push({ node, depth });
      if (node.type === 'folder') {
        rows.push(...this.flatten(node.children, depth + 1));
      }
    }
    return rows;
  }
}
