import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  InputSignal,
  OnDestroy,
  signal,
  WritableSignal,
} from '@angular/core';
import { Icon } from '../../../icons/icon';
import { Repository } from '../../../services/repository/repository';
import { GitBranch } from '../../../services/repository/repository-data';
import {
  SourceControlCommandHandler,
  SourceControlCommands,
} from '../../../services/source-control-commands/source-control-commands';
import { StatusBar, StatusSegment } from '../../../services/status-bar/status-bar';
import { CommitDetail } from './panels/commit-detail/commit-detail';
import { CommitGraph } from './panels/commit-graph/commit-graph';
import { DiffView } from './panels/diff-view/diff-view';
import { SourceControlSidebar } from './panels/source-control-sidebar/source-control-sidebar';

/**
 * Identifies this view's status-bar contribution.
 */
const STATUS_OWNER: string = 'source-control';

/**
 * Orders this view's status contribution among the other owners (lower renders first).
 */
const STATUS_PRIORITY: number = 30;

/**
 * Holds the minimum and maximum widths, in pixels, of the side rails.
 */
const MIN_RAIL: number = 180;
const MAX_RAIL: number = 520;

/**
 * Holds the minimum and maximum heights, in pixels, of the docked diff pane.
 */
const MIN_DIFF: number = 120;
const MAX_DIFF: number = 1200;

/**
 * Names the splitters the layout drags.
 */
type Splitter = 'sidebar' | 'detail' | 'diff';

/**
 * Hosts the source-control workspace as a top-level tab: a GitKraken-style surface over a single
 * repository. The left rail lists branches, remotes, tags, and stashes; the centre column shows the
 * commit graph above a Monaco diff of the selected file; and the right pane details the selected
 * commit. The view owns its own ribbon (through {@link SourceControlCommands}) and contributes branch
 * and change status to the status strip while it is the active tab.
 *
 * The repository data is mock scaffolding (see {@link Repository}); the goal is to exercise the
 * layout, ribbon, status bar, and the diff surface end to end.
 */
@Component({
  selector: 'app-source-control-view',
  imports: [SourceControlSidebar, CommitGraph, CommitDetail, DiffView],
  templateUrl: './source-control-view.html',
  styleUrl: './source-control-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SourceControlView implements OnDestroy {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the repository model the view renders and the ribbon mutates.
   */
  protected readonly repository: Repository = inject(Repository);

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
   * inactive so its diff editor and selection survive tab switches, but it owns the ribbon command
   * handler and status contribution only while active.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Holds the width, in pixels, of the left rail.
   */
  protected readonly sidebarWidth: WritableSignal<number> = signal<number>(240);

  /**
   * Holds the width, in pixels, of the right detail pane.
   */
  protected readonly detailWidth: WritableSignal<number> = signal<number>(340);

  /**
   * Holds the height, in pixels, of the docked diff pane.
   */
  protected readonly diffHeight: WritableSignal<number> = signal<number>(320);

  /**
   * Holds a value indicating whether the diff renders inline (unified) rather than side by side.
   */
  protected readonly inlineDiff: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the splitter drag origin (pointer coordinate at drag start).
   */
  private dragOrigin: number = 0;

  /**
   * Holds the pane size at the start of a splitter drag.
   */
  private dragOriginSize: number = 0;

  /**
   * Holds the command handler registered with the {@link SourceControlCommands} registry while active.
   */
  private commandHandler: SourceControlCommandHandler | null = null;

  /**
   * Wires effects that register the ribbon command handler and publish status while the view is
   * active, and tear both down when it is not.
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
        {
          id: 'sc-branch',
          text: branch?.name ?? 'detached HEAD',
          icon: Icon.SOURCE_CONTROL,
        },
      ];
      if (branch !== undefined && (branch.ahead > 0 || branch.behind > 0)) {
        leading.push({
          id: 'sc-sync',
          text: `↑${branch.ahead} ↓${branch.behind}`,
        });
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
   * Gets the width, in pixels, of the left rail.
   * @returns Returns the rail width.
   */
  protected sidebarSize(): number {
    return this.sidebarWidth();
  }

  /**
   * Gets the width, in pixels, of the right detail pane.
   * @returns Returns the detail width.
   */
  protected detailSize(): number {
    return this.detailWidth();
  }

  /**
   * Gets the height, in pixels, of the docked diff pane.
   * @returns Returns the diff height.
   */
  protected diffSize(): number {
    return this.diffHeight();
  }

  /**
   * Begins a splitter drag that resizes one of the layout's panes.
   * @param event The originating pointer event.
   * @param splitter The splitter being dragged.
   */
  protected onSplitterDown(event: MouseEvent, splitter: Splitter): void {
    event.preventDefault();
    const vertical: boolean = splitter === 'diff';
    this.dragOrigin = vertical ? event.clientY : event.clientX;
    this.dragOriginSize = this.sizeFor(splitter);

    const onMove: (move: MouseEvent) => void = (move: MouseEvent): void => {
      const position: number = vertical ? move.clientY : move.clientX;
      // The sidebar grows as the pointer moves right; the detail and diff grow as it moves left/up.
      const delta: number =
        splitter === 'sidebar' ? position - this.dragOrigin : this.dragOrigin - position;
      this.applySize(splitter, this.dragOriginSize + delta);
    };
    const onUp: () => void = (): void => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  /**
   * Reads the current size of the pane a splitter controls.
   * @param splitter The splitter.
   * @returns Returns the pane size in pixels.
   */
  private sizeFor(splitter: Splitter): number {
    switch (splitter) {
      case 'sidebar':
        return this.sidebarWidth();
      case 'detail':
        return this.detailWidth();
      default:
        return this.diffHeight();
    }
  }

  /**
   * Clamps and applies a new size to the pane a splitter controls.
   * @param splitter The splitter.
   * @param size The proposed size in pixels.
   */
  private applySize(splitter: Splitter, size: number): void {
    if (splitter === 'diff') {
      this.diffHeight.set(Math.min(MAX_DIFF, Math.max(MIN_DIFF, size)));
      return;
    }
    const clamped: number = Math.min(MAX_RAIL, Math.max(MIN_RAIL, size));
    if (splitter === 'sidebar') {
      this.sidebarWidth.set(clamped);
    } else {
      this.detailWidth.set(clamped);
    }
  }

  /**
   * Registers the ribbon command handler, mapping each ribbon action onto the repository (or local
   * view state for the diff toggle).
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
      toggleInlineDiff: (): void => this.inlineDiff.update((value: boolean): boolean => !value),
    };
    this.commands.register(this.commandHandler);
  }
}
