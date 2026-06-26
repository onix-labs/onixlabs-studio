import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  InputSignal,
  OnDestroy,
  OnInit,
  signal,
  WritableSignal,
} from '@angular/core';
import { RepositoryInfo, SourceControlApi } from '../../../../shared/studio-api';
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
import { Repositories } from '../../../services/repositories/repositories';
import { Repository } from '../../../services/repository/repository';
import { GitBranch } from '../../../services/repository/repository-data';
import {
  SourceControlCommandHandler,
  SourceControlCommands,
} from '../../../services/source-control-commands/source-control-commands';
import { StatusBar, StatusSegment } from '../../../services/status-bar/status-bar';
import { Tabs } from '../../../services/tabs/tabs';
import { DockContainer } from '../../dock/dock-container/dock-container';
import { AppIcon } from '../../shared/icon/app-icon';
import { Modal } from '../../shared/modal/modal';
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
 * The tab binds to a git repository the user opens — seeded from the repository stashed for it when
 * opened from the welcome screen, or opened in place from its empty state. A {@link Repository}
 * scoped to this tab reads the repository's data through a version-control provider.
 */
@Component({
  selector: 'app-source-control-view',
  imports: [DockContainer, AppIcon, Modal],
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
export class SourceControlView implements OnInit, OnDestroy {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the git bridge used to open a repository in place from the empty state.
   */
  private readonly api: SourceControlApi | undefined = window.studio?.sourceControl;

  /**
   * Holds the repository model the panels render. Exposed for the template's empty-state guard.
   */
  protected readonly repository: Repository = inject(Repository);

  /**
   * Holds the diff store, swept of closed diffs and toggled between inline/side-by-side by the ribbon.
   */
  private readonly diffs: Diffs = inject(Diffs);

  /**
   * Holds this tab's scoped dock layout, watched to sweep closed diff documents.
   */
  private readonly dockState: DockState = inject(DockState);

  /**
   * Holds the registry that hands this tab its initial repository.
   */
  private readonly repositories: Repositories = inject(Repositories);

  /**
   * Holds the tab registry, used to name this tab after the repository opened in place.
   */
  private readonly tabsService: Tabs = inject(Tabs);

  /**
   * Holds the command registry the ribbon routes its actions through.
   */
  private readonly commands: SourceControlCommands = inject(SourceControlCommands);

  /**
   * Holds the status-bar registry this view contributes branch and change status to.
   */
  private readonly statusBar: StatusBar = inject(StatusBar);

  /**
   * Gets the owning tab's id, used to claim this tab's stashed initial repository and rename it.
   */
  public readonly tabId: InputSignal<string> = input.required<string>();

  /**
   * Gets a value indicating whether the view belongs to the active tab. The view stays mounted when
   * inactive so its dock and diff editors survive tab switches, but it owns the ribbon command handler
   * and status contribution only while active.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Holds whether the new-branch modal is open.
   */
  protected readonly newBranchOpen: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the name typed into the new-branch modal.
   */
  protected readonly newBranchName: WritableSignal<string> = signal<string>('');

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
    // signals so the segments refresh on reload. Clears when inactive or no repository is bound.
    effect((): void => {
      if (!this.isActive() || !this.repository.isBound()) {
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
   * Binds the repository stashed for this tab when it was opened, if any.
   */
  public ngOnInit(): void {
    const initial: RepositoryInfo | undefined = this.repositories.takeInitial(this.tabId());
    if (initial !== undefined) {
      this.repository.bind(initial);
    }
  }

  /**
   * Clears the ribbon command handler and status contribution, and releases the repository, when the
   * view is torn down.
   */
  public ngOnDestroy(): void {
    if (this.commandHandler !== null) {
      this.commands.unregister(this.commandHandler);
      this.commandHandler = null;
    }
    this.statusBar.clearOwner(STATUS_OWNER);
    void this.repository.close();
  }

  /**
   * Opens the new-branch modal with an empty name.
   */
  protected openNewBranch(): void {
    this.newBranchName.set('');
    this.newBranchOpen.set(true);
  }

  /**
   * Closes the new-branch modal.
   */
  protected closeNewBranch(): void {
    this.newBranchOpen.set(false);
  }

  /**
   * Updates the typed branch name.
   * @param event The input event.
   */
  protected onNewBranchInput(event: Event): void {
    this.newBranchName.set((event.target as HTMLInputElement).value);
  }

  /**
   * Creates the branch named in the modal and closes it. A blank name is ignored.
   */
  protected confirmNewBranch(): void {
    const name: string = this.newBranchName().trim();
    if (name.length === 0) {
      return;
    }
    void this.repository.createBranch(name);
    this.newBranchOpen.set(false);
  }

  /**
   * Opens a git repository into this (empty) tab from its empty state, binding it in place and naming
   * the tab after the repository.
   */
  protected async openRepositoryHere(): Promise<void> {
    const info: RepositoryInfo | null = await (this.api?.openRepository() ?? Promise.resolve(null));
    if (info === null) {
      return;
    }
    this.tabsService.rename(this.tabId(), info.name);
    this.repository.bind(info);
  }

  /**
   * Registers the ribbon command handler. Refresh reloads the repository and the diff-layout toggle
   * flips the diff store; the mutating actions are wired in a later slice.
   */
  private registerCommandHandler(): void {
    if (this.commandHandler !== null) {
      return;
    }
    this.commandHandler = {
      refresh: (): void => void this.repository.refresh(),
      fetch: (): void => undefined,
      pull: (): void => undefined,
      push: (): void => undefined,
      stageAll: (): void => void this.repository.stageAll(),
      commit: (): void => void this.repository.commit(),
      stash: (): void => void this.repository.stash(),
      newBranch: (): void => this.openNewBranch(),
      toggleInlineDiff: (): void => this.diffs.toggleInline(),
    };
    this.commands.register(this.commandHandler);
  }
}
