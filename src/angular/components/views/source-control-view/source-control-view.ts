import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  InputSignal,
  OnDestroy,
} from '@angular/core';
import { Icon } from '../../../icons/icon';
import { DOCK_BLUEPRINT } from '../../../services/dock/dock-blueprint';
import { DockAutoHide } from '../../../services/dock/dock-auto-hide';
import { DockDrag } from '../../../services/dock/dock-drag';
import { DockFloating } from '../../../services/dock/dock-floating';
import { DockFocus } from '../../../services/dock/dock-focus';
import { DockGeometry } from '../../../services/dock/dock-geometry';
import { DockPanelRegistry } from '../../../services/dock/dock-panel-registry';
import { DockState } from '../../../services/dock/dock-state';
import { collectPanelIds } from '../../../services/dock/dock-tree';
import { DiffOpener } from '../../../services/diffs/diff-opener';
import { Diffs } from '../../../services/diffs/diffs';
import { Repository } from '../../../services/repository/repository';
import { GitBranch } from '../../../services/repository/repository-data';
import {
  SourceControlCommandHandler,
  SourceControlCommands,
} from '../../../services/source-control-commands/source-control-commands';
import { StatusBar, StatusSegment } from '../../../services/status-bar/status-bar';
import { DockContainer } from '../../dock/dock-container/dock-container';
import { REPOSITORY_DOCK_BLUEPRINT } from './repository-dock-blueprint';

/**
 * Identifies this view's status-bar contribution.
 */
const STATUS_OWNER: string = 'source-control';

/**
 * Orders this view's status contribution among the other owners (lower renders first).
 */
const STATUS_PRIORITY: number = 30;

/**
 * Hosts the source-control workspace as a top-level tab: a GitKraken-style repository surface built
 * on the same dock framework as the directory (IDE) tab. It provides its own dock services and a
 * {@link REPOSITORY_DOCK_BLUEPRINT}, so the Repository rail, commit History, and Commit detail dock as
 * tool panels and changed-file diffs open into the document well — all draggable, floatable, and
 * resizable. The view owns its ribbon (through {@link SourceControlCommands}) and contributes branch
 * and change status to the status strip while it is the active tab.
 *
 * The repository data is mock scaffolding (see {@link Repository}); the goal is to exercise the dock
 * reuse, the panels, the ribbon, the status bar, and the Monaco diff surface end to end.
 */
@Component({
  selector: 'app-source-control-view',
  imports: [DockContainer],
  templateUrl: './source-control-view.html',
  styleUrl: './source-control-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    Repository,
    Diffs,
    DiffOpener,
    DockState,
    DockGeometry,
    DockFocus,
    DockPanelRegistry,
    DockFloating,
    DockAutoHide,
    DockDrag,
    { provide: DOCK_BLUEPRINT, useValue: REPOSITORY_DOCK_BLUEPRINT },
  ],
})
export class SourceControlView implements OnDestroy {
  /**
   * Holds the repository model the panels render and the ribbon mutates.
   */
  private readonly repository: Repository = inject(Repository);

  /**
   * Holds the diff store, swept of closed diffs and toggled between inline/side-by-side by the ribbon.
   */
  private readonly diffs: Diffs = inject(Diffs);

  /**
   * Holds this tab's scoped dock layout, watched to sweep closed diff documents.
   */
  private readonly dockState: DockState = inject(DockState);

  /**
   * Holds the command registry the ribbon routes its actions through.
   */
  private readonly commands: SourceControlCommands = inject(SourceControlCommands);

  /**
   * Holds the status-bar registry this view contributes branch and change status to.
   */
  private readonly statusBar: StatusBar = inject(StatusBar);

  /**
   * Gets a value indicating whether the view belongs to the active tab. The view stays mounted when
   * inactive so its dock and diff editors survive tab switches, but it owns the ribbon command handler
   * and status contribution only while active.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Holds the command handler registered with the {@link SourceControlCommands} registry while active.
   */
  private commandHandler: SourceControlCommandHandler | null = null;

  /**
   * Wires effects that register the ribbon command handler and publish status while the view is
   * active, and that sweep diff records for tabs the user has closed.
   */
  public constructor() {
    effect((): void => {
      if (this.isActive()) {
        this.registerCommandHandler();
      } else if (this.commandHandler !== null) {
        this.commands.unregister(this.commandHandler);
        this.commandHandler = null;
      }
    });

    // Drop diff records once their dock tab is gone, so closed diffs are not retained.
    effect((): void => {
      const present: ReadonlySet<string> = new Set<string>(
        collectPanelIds(this.dockState.layout()),
      );
      this.diffs.removeMissing(present);
    });

    // Publish branch and change status to the status strip while active, reading the repository
    // signals so the segments refresh on checkout, commit, push, and pull. Clears when inactive.
    effect((): void => {
      if (!this.isActive()) {
        this.statusBar.clearOwner(STATUS_OWNER);
        return;
      }
      const branch: GitBranch | undefined = this.repository.currentBranch();
      const changes: number = this.repository.changeCount();
      const leading: StatusSegment[] = [
        { id: 'sc-branch', text: branch?.name ?? 'detached HEAD', icon: Icon.SOURCE_CONTROL },
      ];
      if (branch !== undefined && (branch.ahead > 0 || branch.behind > 0)) {
        leading.push({ id: 'sc-sync', text: `↑${branch.ahead} ↓${branch.behind}` });
      }
      const trailing: StatusSegment[] = [
        { id: 'sc-changes', text: `${changes} changed`, icon: Icon.PENCIL },
        { id: 'sc-repo', text: this.repository.repoName() },
      ];
      this.statusBar.contribute(STATUS_OWNER, { leading, trailing }, STATUS_PRIORITY);
    });
  }

  /**
   * Clears the ribbon command handler and status contribution when the view is torn down.
   */
  public ngOnDestroy(): void {
    if (this.commandHandler !== null) {
      this.commands.unregister(this.commandHandler);
      this.commandHandler = null;
    }
    this.statusBar.clearOwner(STATUS_OWNER);
  }

  /**
   * Registers the ribbon command handler, mapping each ribbon action onto the repository (or the diff
   * store for the inline-diff toggle).
   */
  private registerCommandHandler(): void {
    if (this.commandHandler !== null) {
      return;
    }
    this.commandHandler = {
      refresh: (): void => undefined,
      fetch: (): void => undefined,
      pull: (): void => this.repository.pull(),
      push: (): void => this.repository.push(),
      stageAll: (): void => this.repository.stageAll(),
      commit: (): void => this.repository.commit('Update working tree'),
      stash: (): void => this.repository.stash(),
      newBranch: (): void => this.repository.createBranch(),
      toggleInlineDiff: (): void => this.diffs.toggleInline(),
    };
    this.commands.register(this.commandHandler);
  }
}
