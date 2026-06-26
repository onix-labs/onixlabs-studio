import { ChangeDetectionStrategy, Component, inject, input, InputSignal } from '@angular/core';
import { Icon } from '../../../../../icons/icon';
import { DockPanel } from '../../../../../services/dock/dock-panel';
import { Repository, WORKING_NODE_ID } from '../../../../../services/repository/repository';
import { GitBranch } from '../../../../../services/repository/repository-data';
import { AppIcon } from '../../../../shared/icon/app-icon';

/**
 * Renders the source-control view's left rail: the uncommitted-changes entry followed by sections for
 * local branches, remotes, tags, and stashes. Selecting the working entry or a branch drives the
 * repository's selection and checkout; the rest are read-only references in this scaffold.
 */
@Component({
  selector: 'app-source-control-sidebar',
  imports: [AppIcon],
  templateUrl: './source-control-sidebar.html',
  styleUrl: './source-control-sidebar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SourceControlSidebar {
  /**
   * Gets the dock panel descriptor this panel was projected for. Supplied by the dock outlet; the
   * sidebar reads its state from the shared {@link Repository} rather than the descriptor.
   */
  public readonly panel: InputSignal<DockPanel> = input.required<DockPanel>();

  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the working-tree node identifier, exposed for the template.
   */
  protected readonly workingNodeId: string = WORKING_NODE_ID;

  /**
   * Holds the repository model the rail renders.
   */
  protected readonly repository: Repository = inject(Repository);

  /**
   * Selects the working-tree node, so the detail and diff panes show the uncommitted changes.
   */
  protected selectWorking(): void {
    this.repository.selectNode(this.workingNodeId);
  }

  /**
   * Navigates to a branch's tip commit.
   * @param branch The branch to navigate to.
   */
  protected selectBranch(branch: GitBranch): void {
    this.repository.selectNode(branch.tip);
  }

  /**
   * Checks out a branch.
   * @param branch The branch to check out.
   */
  protected checkout(branch: GitBranch): void {
    void this.repository.checkout(branch.name);
  }
}
