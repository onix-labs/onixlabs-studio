import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { ProjectModel } from '../../../../shared/project-system';
import { DockPanel } from '../../../services/dock/dock-panel';
import { FileOpener } from '../../../services/file-opener/file-opener';
import { SolutionModel, SolutionRow } from '../../../services/project/solution-model';
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
 * Renders the logical solution model (solution folders, projects, and each project's files) as the body
 * of the Solution Explorer dock panel — distinct from the File Explorer's filesystem tree. The model
 * and its expansion/loading state come from the tab-scoped {@link SolutionModel}; a project's files load
 * on first expansion. Clicking an expandable row toggles it; clicking a file opens it.
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
   * Holds the opener used to open a file into an editor tab.
   */
  private readonly fileOpener: FileOpener = inject(FileOpener);

  /**
   * Gets the current solution model, or null when there is none (the empty state).
   */
  public readonly model: Signal<ProjectModel | null> = this.solution.model;

  /**
   * Gets the flattened, visible rows of the solution tree.
   */
  public readonly rows: Signal<readonly SolutionRow[]> = this.solution.rows;

  /**
   * Computes the left padding for a row at the given depth.
   * @param depth The row's depth in the tree.
   * @returns Returns the left padding in pixels.
   */
  public indentFor(depth: number): number {
    return BASE_INDENT + depth * INDENT_STEP;
  }

  /**
   * Resolves a row's icon by its kind and expansion.
   * @param row The row to resolve an icon for.
   * @returns Returns the row's icon.
   */
  public iconFor(row: SolutionRow): Icon {
    switch (row.kind) {
      case 'project':
        return Icon.PROJECT;
      case 'folder':
      case 'item-folder':
        return row.expanded ? Icon.FOLDER_OPEN : Icon.DIRECTORY;
      default:
        return this.fileIconFor(row.label);
    }
  }

  /**
   * Handles a click on a row: toggles an expandable row, or opens a file.
   * @param row The row that was clicked.
   */
  public onRowClick(row: SolutionRow): void {
    if (row.expandable) {
      this.solution.toggle(row);
    } else if (row.path !== null) {
      void this.fileOpener.openPath(row.path);
    }
  }

  /**
   * Resolves a file's icon from its extension.
   * @param name The file name.
   * @returns Returns the file's icon.
   */
  private fileIconFor(name: string): Icon {
    const dot: number = name.lastIndexOf('.');
    switch (dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()) {
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
      case 'xml':
      case 'csproj':
      case 'props':
      case 'targets':
        return Icon.FILE_JSON;
      default:
        return Icon.FILE;
    }
  }
}
