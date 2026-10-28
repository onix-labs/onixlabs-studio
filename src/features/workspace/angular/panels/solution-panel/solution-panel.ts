import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  InputSignal,
  signal,
  Signal,
  untracked,
  WritableSignal,
} from '@angular/core';
import {
  ProjectAction,
  ProjectEntry,
  ProjectModel,
  ProjectOperationResult,
} from '@shared/api/project-system';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { SolutionModel, SolutionRow } from '@features/workspace/angular/project/solution-model';
import {
  ExplorerScmState,
  isChangedState,
  scmRowFields,
  WorkspaceGit,
} from '@features/workspace/angular/workspace-git/workspace-git';
import {
  ExplorerVcsMenu,
  ExplorerVcsTarget,
} from '@features/workspace/angular/workspace-git/explorer-vcs-menu';
import { Log } from '@shared/angular/services/log/log';
import { ExplorerFilterKind } from '@shared/angular/services/explorer-filter/explorer-filter';
import { WorkspaceProblems } from '@features/workspace/angular/workspace-problems/workspace-problems';
import { DiagnosticSeverity } from '@shared/angular/services/diagnostics/diagnostics';
import { Icon } from '@shared/angular/icons/icon';
import {
  ExplorerFilterState,
  ExplorerToolbar,
} from '@shared/angular/components/explorer-toolbar/explorer-toolbar';
import { HighlightedText } from '@shared/angular/components/highlighted-text/highlighted-text';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Button } from '@shared/angular/components/forms/button/button';
import { ButtonRow } from '@shared/angular/components/forms/button-row/button-row';
import { PanelStatus } from '@shared/angular/components/panel-status/panel-status';
import { MenuItem } from '@shared/angular/components/menu/menu';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';
import { Notifications } from '@shared/angular/services/notifications/notifications';
import { Shell } from '@shared/angular/services/shell/shell';
import { OPEN_IN_FILE_SYSTEM_LABEL } from '@shared/angular/services/shell/shell-labels';
import { BuildRunner } from '@shared/angular/services/tasks/build-runner';
import {
  TreeSelectGesture,
  TreeSelection,
} from '@shared/angular/components/tree-view/tree-selection';
import {
  TreeEdit,
  TreeMenuSelection,
  TreeRow,
  TreeView,
} from '@shared/angular/components/tree-view/tree-view';

/**
 * Identifies the context-menu and toolbar actions the panel offers.
 */
const ACTION_OPEN: string = 'open';
const ACTION_EDIT_PROJECT: string = 'edit-project';
const ACTION_COPY_PATH: string = 'copy-path';
const ACTION_COPY_RELATIVE: string = 'copy-relative-path';
const ACTION_REVEAL: string = 'reveal';
const ACTION_OPTIONS: string = 'options';
const ACTION_FOLLOW: string = 'follow-active';
const ACTION_GIT_STATUS: string = 'git-status';
const ACTION_RELOAD: string = 'reload';
const ACTION_OPEN_ROOT: string = 'open-root';
const ACTION_RENAME_FOLDER: string = 'rename-folder';

/**
 * Prefixes the context-menu id of a capability action run against a single project, so the handler can
 * tell a project verb from the panel's own commands and recover which verb it was.
 */
const PROJECT_ACTION_PREFIX: string = 'project-action:';

/**
 * The capability actions a project row offers, in the order they are shown, each with the label it is
 * shown under.
 *
 * The order is the ribbon's: the compile-time verbs first, then the ones that do something with what
 * was compiled. A project offers whichever of these its project system declares *and* its toolchain
 * can express against one project — the rest are omitted, never disabled, so the menu never promises a
 * narrowing it cannot perform.
 */
const PROJECT_ACTIONS: readonly {
  readonly action: ProjectAction;
  readonly label: string;
  readonly icon: Icon;
}[] = [
  { action: 'build', label: 'Build', icon: Icon.BUILD },
  { action: 'rebuild', label: 'Rebuild', icon: Icon.REBUILD },
  { action: 'clean', label: 'Clean', icon: Icon.CLEAN },
  { action: 'test', label: 'Test', icon: Icon.TEST },
  { action: 'publish', label: 'Publish', icon: Icon.PUBLISH },
  { action: 'restore', label: 'Restore', icon: Icon.RESTORE },
];

/**
 * A capability action awaiting the user's confirmation to stop a busy Build terminal and take it over.
 */
interface PendingProjectAction {
  /**
   * Gets the action the user chose.
   */
  readonly action: ProjectAction;

  /**
   * Gets the label the action was chosen under, used to name it in the prompt.
   */
  readonly label: string;

  /**
   * Gets the project the action runs against.
   */
  readonly project: ProjectEntry;
}

/**
 * Renders the logical solution model (solution folders, projects, and each project's files) as the body
 * of the Solution Explorer dock panel, through the shared {@link TreeView} — distinct from the File
 * Explorer's filesystem tree. The model and its expansion/loading state come from the tab-scoped
 * {@link SolutionModel}; a project's files load on first expansion. Clicking an expandable row toggles
 * it; clicking a file opens it.
 */
@Component({
  selector: 'app-solution-panel',
  imports: [
    AppIcon,
    TreeView,
    ExplorerToolbar,
    HighlightedText,
    Modal,
    ModalContent,
    Button,
    ButtonRow,
    PanelStatus,
  ],
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
   * Holds the workspace git status the rows are decorated from.
   */
  private readonly git: WorkspaceGit = inject(WorkspaceGit);

  /**
   * Holds where the workspace's problems are, for the error squiggles and the filter (#1182 follow-up).
   */
  private readonly problems: WorkspaceProblems = inject(WorkspaceProblems);

  /**
   * Holds the version-control commands a row offers, shared with the File Explorer (#1041).
   */
  private readonly vcsMenu: ExplorerVcsMenu = inject(ExplorerVcsMenu);

  /**
   * Holds the structured logger for solution explorer actions.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the shell service used to reveal a path in the operating system's file manager.
   */
  private readonly shell: Shell = inject(Shell);

  /**
   * Holds this workspace's build runner, which the row's capability actions dispatch into.
   *
   * Injected directly rather than through the {@link import('@shared/angular/services/tasks/builds').Builds}
   * seam: that seam routes to whichever workspace is *active*, whereas this panel belongs to one
   * directory view and must act on its own workspace — the same one whose projects it is showing.
   */
  private readonly buildRunner: BuildRunner = inject(BuildRunner);

  /**
   * Holds the solution-folder row being renamed in place, or null when none is.
   */
  public readonly renameTarget: WritableSignal<SolutionRow | null> = signal<SolutionRow | null>(
    null,
  );

  /**
   * Holds the notification sink a refused rename is reported through.
   */
  private readonly notifications: Notifications = inject(Notifications);

  /**
   * Holds the project action awaiting the user's stop-and-restart confirmation, or null when none is.
   * Set when a verb is chosen while the Build terminal is busy; the modal it opens either dispatches
   * with restart granted or discards the request. A busy build is never stopped silently.
   */
  protected readonly pendingAction: WritableSignal<PendingProjectAction | null> =
    signal<PendingProjectAction | null>(null);

  /**
   * Gets the toolbar's overflow items: the actions that belong to the panel as a whole rather than to
   * any one row, which is what the row context menu is for.
   *
   * The panel's two standing switches are gathered under an Options submenu, leaving the top level to
   * the commands — things that happen once when chosen. Each switch carries a checkbox showing its
   * current state, so the menu answers "is this on?" without the user having to look at the tree and
   * infer it. Computed rather than fixed for exactly that reason: the boxes must read the model each
   * time the menu opens.
   */
  public readonly moreItems: Signal<readonly MenuItem[]> = computed((): readonly MenuItem[] => [
    {
      id: ACTION_OPTIONS,
      label: 'Options',
      icon: Icon.OPTIONS,
      children: [
        {
          id: ACTION_FOLLOW,
          label: 'Follow Focused Document',
          checked: this.solution.followsActiveDocument(),
        },
        {
          id: ACTION_GIT_STATUS,
          label: 'Show Git Status',
          checked: this.solution.showsGitStatus(),
        },
      ],
    },
    { id: ACTION_OPEN_ROOT, label: OPEN_IN_FILE_SYSTEM_LABEL, icon: Icon.DIRECTORY },
    { id: ACTION_RELOAD, label: 'Reload Solution', icon: Icon.REFRESH },
  ]);

  /**
   * Builds a row's context-menu items.
   *
   * Bound as a value rather than a method, because the tree calls it as its item factory when a menu
   * opens — `this` must stay this component. Items that do not apply to the row are omitted rather
   * than disabled: unlike a fixed toolbar menu, a context menu is summoned onto a specific row, so
   * there is no expectation of a stable shape to preserve.
   */
  public readonly contextMenuFor: (treeRow: TreeRow) => readonly MenuItem[] = (
    treeRow: TreeRow,
  ): readonly MenuItem[] => {
    const targets: readonly SolutionRow[] = this.targetsOf(treeRow);
    if (targets.length > 1) {
      return this.selectionItems(targets);
    }
    const row: SolutionRow = this.rowOf(treeRow);
    const path: string | null = this.pathFor(row);
    const items: MenuItem[] = [];

    if (row.kind === 'file') {
      items.push({ id: ACTION_OPEN, label: 'Open', icon: Icon.FILE });
    }
    if (row.kind === 'project') {
      items.push({ id: ACTION_EDIT_PROJECT, label: 'Edit Project File', icon: Icon.PROJECT });
      items.push(...this.projectActionItems(row));
    }
    // A solution folder stands for no directory, so it gets none of the path commands — but the
    // solution file names it, and providers that can rewrite that name say so through their
    // capabilities. One that cannot leaves the row menu-less, exactly as before.
    if (row.kind === 'folder' && this.model()?.capabilities.renamesSolutionFolders === true) {
      items.push({ id: ACTION_RENAME_FOLDER, label: 'Rename', icon: Icon.PENCIL });
    }
    if (path !== null) {
      items.push(
        { id: ACTION_COPY_PATH, label: 'Copy Path', icon: Icon.COPY },
        { id: ACTION_COPY_RELATIVE, label: 'Copy Relative Path', icon: Icon.COPY },
        { id: ACTION_REVEAL, label: OPEN_IN_FILE_SYSTEM_LABEL, icon: Icon.DIRECTORY },
      );
      // Under one separator, pushed only when there is something for it to divide.
      const vcs: readonly MenuItem[] = this.vcsMenu.itemsFor([this.vcsTarget(row, path)]);
      if (vcs.length > 0) {
        items.push({ id: 'solution-menu.sep-vcs', label: '', separator: true }, ...vcs);
      }
    }
    return items;
  };

  /**
   * Turns a solution folder's row into a field seeded with its current name, so the common edit
   * (adjusting a word) does not begin with retyping the whole thing.
   * @param row The solution-folder row to rename.
   */
  private beginRename(row: SolutionRow): void {
    this.log.info('workspace.solution', 'Rename solution folder', row.key);
    this.renameTarget.set(row);
  }

  /**
   * Ends the rename without acting on it — abandoned, or committed with no new name to apply.
   */
  public cancelRename(): void {
    this.renameTarget.set(null);
  }

  /**
   * Renames the solution folder being edited to the name its row was given, then ends the edit.
   *
   * The row returns to showing the folder whether or not the write took: a refusal is reported as a
   * notification, and holding the field open over a name the main process has already rejected would
   * leave the user retyping into a box that does not say which part it objected to. A name with a path
   * separator is refused here, before the write: a solution folder is one segment of a declared path,
   * and a slash would silently nest it instead.
   * @param commit The edited row and the trimmed name it was given.
   * @returns Returns a promise that resolves once the rename has been attempted.
   */
  public async commitRename(commit: TreeEdit): Promise<void> {
    const row: SolutionRow | null = this.renameTarget();
    if (commit.row.id !== row?.key) {
      return;
    }
    this.renameTarget.set(null);
    if (/[/\\]/.test(commit.value)) {
      this.reportRenameFailure('A folder name cannot contain a slash.');
      return;
    }
    const result: ProjectOperationResult = await this.solution.renameSolutionFolder(
      row,
      commit.value,
    );
    if (!result.success) {
      this.reportRenameFailure(result.error);
    }
  }

  /**
   * Reports a rename that did not take, since the row it was typed into has already closed.
   * @param detail Why it did not take, when that is known.
   */
  private reportRenameFailure(detail: string | undefined): void {
    this.log.warn('workspace.solution', 'Could not rename folder', detail);
    this.notifications.notify({
      severity: 'error',
      title: 'Could not rename folder',
      detail,
    });
  }

  /**
   * Builds the capability-action items for a project row: the verbs its project system declares,
   * narrowed to those its toolchain can actually aim at one project, under a separator that keeps them
   * apart from the row's file commands.
   *
   * Two independent gates, and both must pass. `ProjectCapabilities.actions` says what the ecosystem
   * *has* — a Node package with no `test` script has no Test. {@link BuildRunner.supportsProjectAction}
   * says what it can *narrow* — Go has Build, but models one project per root, so a per-project Build
   * would be the workspace build wearing a project's name. Failing either gate omits the verb, which
   * is the whole point: the menu never offers a project build it would have to widen.
   * @param row The project row.
   * @returns Returns the action items, or an empty list when the row offers none.
   */
  private projectActionItems(row: SolutionRow): readonly MenuItem[] {
    const declared: readonly ProjectAction[] = this.model()?.capabilities.actions ?? [];
    if (this.projectFor(row) === null) {
      return [];
    }
    const verbs: readonly MenuItem[] = PROJECT_ACTIONS.filter(
      (candidate: { action: ProjectAction }): boolean =>
        declared.includes(candidate.action) &&
        this.buildRunner.supportsProjectAction(candidate.action),
    ).map((candidate: { action: ProjectAction; label: string; icon: Icon }): MenuItem => ({
      id: `${PROJECT_ACTION_PREFIX}${candidate.action}`,
      label: candidate.label,
      icon: candidate.icon,
    }));
    if (verbs.length === 0) {
      return [];
    }
    // A separator is a rule in its own right, not a flag on the item below it — so it is only pushed
    // once there is something for it to divide.
    return [{ id: 'project-action.sep', label: '', separator: true }, ...verbs];
  }

  /**
   * Resolves the project a row stands for, by matching the row's path against the model's projects.
   *
   * Matched rather than synthesised from the row, because the families that address a project by name
   * (Cargo's `-p`) need the project system's own name for it — a crate's package name, which need not
   * be its directory's — and the row carries only what it displays.
   * @param row The row to resolve.
   * @returns Returns the project, or null when the row stands for none.
   */
  private projectFor(row: SolutionRow): ProjectEntry | null {
    if (row.kind !== 'project' || row.path === null) {
      return null;
    }
    return (
      this.model()?.projects.find((entry: ProjectEntry): boolean => entry.path === row.path) ?? null
    );
  }

  /**
   * Resolves the path a row's commands act on.
   *
   * The workspace root row carries no path of its own — it is synthesised to head the tree rather
   * than read from the project model — but it plainly stands for the root directory, and offering
   * nothing on the one row every solution has reads as a broken menu. Solution folders are the
   * opposite case and genuinely resolve to nothing: they are groupings inside the `.sln` with no
   * directory behind them, so a path command would have to invent one.
   * @param row The row to resolve.
   * @returns Returns the path the row's commands act on, or null when it stands for nothing on disk.
   */
  private pathFor(row: SolutionRow): string | null {
    if (row.path !== null) {
      return row.path;
    }
    return row.kind === 'solution' ? (this.model()?.root ?? null) : null;
  }

  /**
   * Gets the current solution model, or null when there is none (the empty state).
   */
  public readonly model: Signal<ProjectModel | null> = this.solution.model;

  /**
   * Gets the active search query, bound to the toolbar's search box.
   */
  protected readonly query: Signal<string> = this.solution.query;

  /**
   * Gets the key of the selected row, or null when nothing is selected.
   */
  protected readonly selectedKey: Signal<string | null> = this.solution.selectedKey;

  /**
   * Holds which rows are selected (#1048). The solution model's selected key is the row last acted
   * on; this holds the rest of a multi-row selection around it.
   */
  protected readonly selection: TreeSelection = new TreeSelection();

  /**
   * Keeps the selection in step when the selected row is moved from outside — following the focused
   * document, a click on empty space — by making that row the selection.
   */
  private readonly followSelectedKey: unknown = effect((): void => {
    const key: string | null = this.solution.selectedKey();
    untracked((): void => {
      if (key !== this.selection.focused()) {
        this.selection.replace(key);
      }
    });
  });

  /**
   * Gets the solution's visible rows mapped to tree rows for the shared {@link TreeView}.
   */
  protected readonly rows: Signal<readonly TreeRow[]> = computed((): readonly TreeRow[] =>
    this.shownRows().map((row: SolutionRow): TreeRow => ({
      id: row.key,
      depth: row.depth,
      expandable: row.expandable,
      expanded: row.expanded,
      // Greyed out until what it stands for has arrived. Presentation only: an unready project is
      // still expandable, and expanding one is how its contents get requested ahead of the sweep.
      disabled: row.pending,
      // How version control sees what the row stands for, in colour (#860) — when the Solution
      // Explorer shows source-control state at all.
      ...(this.solution.showsGitStatus() ? scmRowFields(this.scmStateFor(row)) : {}),
      // An error in what the row stands for, or anywhere beneath it, squiggles its name.
      ...(this.hasProblems(row, 'error') ? { squiggle: true } : {}),
      data: row,
    })),
  );

  /**
   * Gets where the selection is, for the status strip: the folder holding what the selected row stands
   * for, from the solution's folder down (`studio/src/App`) — or the solution's folder alone when
   * nothing is selected, or the row stands for no file of its own (a solution folder).
   */
  protected readonly statusLocation: Signal<string> = computed((): string => {
    const root: string = this.model()?.root ?? '';
    const rootName: string =
      root
        .split(/[\\/]/)
        .filter((part: string): boolean => part !== '')
        .pop() ?? '';
    const key: string | null = this.solution.selectedKey();
    const row: SolutionRow | undefined =
      key === null
        ? undefined
        : this.solution.rows().find((candidate: SolutionRow): boolean => candidate.key === key);
    if (row?.path === null || row?.path === undefined) {
      return rootName;
    }
    const relative: string = this.relativePath(row.path);
    const cut: number = Math.max(relative.lastIndexOf('/'), relative.lastIndexOf('\\'));
    return cut < 0 ? rootName : `${rootName}/${relative.slice(0, cut).replaceAll('\\', '/')}`;
  });

  /**
   * Gets what is selected, for the status strip: the row's label and icon, how many rows when several
   * are, or null when nothing is.
   */
  protected readonly statusSelection: Signal<{
    readonly text: string;
    readonly icon: Icon;
  } | null> = computed((): { readonly text: string; readonly icon: Icon } | null => {
    const count: number = this.selection.ids().length;
    if (count > 1) {
      return { text: `${count} selections`, icon: Icon.LIST_ALL };
    }
    const key: string | null = this.solution.selectedKey();
    const row: SolutionRow | undefined =
      key === null
        ? undefined
        : this.solution.rows().find((candidate: SolutionRow): boolean => candidate.key === key);
    return row === undefined ? null : { text: row.label, icon: this.iconFor(row) };
  });

  /**
   * Gets the kinds the tree is narrowed to that can narrow it here (#1182 follow-up): those ticked,
   * less Show Differences outside a repository, where nothing is changed.
   */
  private readonly filterKinds: Signal<ReadonlySet<ExplorerFilterKind>> = computed(
    (): ReadonlySet<ExplorerFilterKind> => {
      const selected: ReadonlySet<ExplorerFilterKind> = this.solution.filter.selected();
      if (!selected.has('changes') || this.git.isRepository()) {
        return selected;
      }
      const usable: Set<ExplorerFilterKind> = new Set<ExplorerFilterKind>(selected);
      usable.delete('changes');
      return usable;
    },
  );

  /**
   * Gets the tool strip's filter: what is ticked, Show Differences not offered at all outside a
   * repository, and inert in one with nothing changed.
   */
  protected readonly filterState: Signal<ExplorerFilterState> = computed(
    (): ExplorerFilterState => ({
      selected: this.solution.filter.selected(),
      unavailable:
        this.git.isRepository() && !this.git.hasChanges() ? { changes: 'no changes' } : {},
      ...(this.git.isRepository() ? {} : { hidden: ['changes'] }),
    }),
  );

  /**
   * Ticks or unticks a kind in the filter, from the tool strip's funnel.
   * @param kind The kind.
   */
  protected toggleFilter(kind: ExplorerFilterKind): void {
    this.solution.filter.toggle(kind);
  }

  /**
   * Unticks Show Differences once nothing is changed — after a commit, say — so the tree goes back to
   * showing everything else rather than standing empty (#1053). Waits for the repository's status to
   * be read, so a repository that has only just opened is not taken for a clean one.
   */
  private readonly leaveWhenClean: unknown = effect((): void => {
    if (
      this.solution.filter.selected().has('changes') &&
      this.git.isRepository() &&
      this.git.statusRead() &&
      !this.git.hasChanges()
    ) {
      untracked((): void => this.solution.filter.clear('changes'));
    }
  });

  /**
   * Gets the solution's rows the tree shows: all of them, or — narrowed — the files matching any kind
   * ticked and the projects and folders on the way to them. The root row stays, since it heads the
   * tree.
   */
  private readonly shownRows: Signal<readonly SolutionRow[]> = computed(
    (): readonly SolutionRow[] => {
      const rows: readonly SolutionRow[] = this.solution.rows();
      const kinds: ReadonlySet<ExplorerFilterKind> = this.filterKinds();
      return kinds.size === 0
        ? rows
        : rows.filter(
            (row: SolutionRow): boolean => row.kind === 'solution' || this.matches(row, kinds),
          );
    },
  );

  /**
   * Holds the rows the filter opened to lead to what it shows, so clearing it closes exactly those,
   * and a row the user closes is not opened again behind their back.
   */
  private readonly openedForFilter: Set<string> = new Set<string>();

  /**
   * Opens the projects and folders that lead to what the filter shows while it narrows the tree —
   * level by level, as each one's contents arrive — and closes them again when it is cleared.
   */
  private readonly followFilter: unknown = effect((): void => {
    const kinds: ReadonlySet<ExplorerFilterKind> = this.filterKinds();
    const rows: readonly SolutionRow[] = this.solution.rows();
    untracked((): void => {
      if (kinds.size === 0) {
        for (const row of rows) {
          if (this.openedForFilter.has(row.key) && row.expanded) {
            this.solution.toggle(row);
          }
        }
        this.openedForFilter.clear();
        return;
      }
      for (const row of rows) {
        if (
          row.expandable &&
          !row.expanded &&
          !row.loading &&
          !this.openedForFilter.has(row.key) &&
          this.matches(row, kinds)
        ) {
          this.openedForFilter.add(row.key);
          this.solution.toggle(row);
        }
      }
    });
  });

  /**
   * Determines whether a row matches any kind the tree is narrowed to: what it stands for changed, or
   * has problems of a ticked severity — or leads to something that does.
   * @param row The row.
   * @param kinds The kinds.
   * @returns Returns true when it does.
   */
  private matches(row: SolutionRow, kinds: ReadonlySet<ExplorerFilterKind>): boolean {
    for (const kind of kinds) {
      if (
        kind === 'changes' ? isChangedState(this.scmStateFor(row)) : this.hasProblems(row, kind)
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Determines whether what a row stands for has problems of a severity, or leads to something that
   * does: any of its paths — a file, a project's file or directory, a solution folder's projects, the
   * solution's own folder.
   * @param row The row.
   * @param severity The severity.
   * @returns Returns true when it does.
   */
  private hasProblems(row: SolutionRow, severity: DiagnosticSeverity): boolean {
    return row.scmPaths.some((path: string): boolean => this.problems.has(path, severity));
  }

  /**
   * Resolves how version control sees what a row stands for. A solution folder has no directory of
   * its own, so it reads as `contains` — as a folder in the File Explorer does — when any project
   * beneath it holds a change; every other row takes the first state among its paths, so a project's
   * edited project file wins over the `contains` its directory would report.
   * @param row The row to resolve.
   * @returns Returns the state, or null when unchanged or standing for nothing on disk.
   */
  private scmStateFor(row: SolutionRow): ExplorerScmState | null {
    const states: ExplorerScmState[] = row.scmPaths
      .map((path: string): ExplorerScmState | null => this.git.stateFor(path))
      .filter((state: ExplorerScmState | null): state is ExplorerScmState => state !== null);
    if (row.kind === 'folder') {
      return states.some((state: ExplorerScmState): boolean => state !== 'ignored')
        ? 'contains'
        : null;
    }
    return states[0] ?? null;
  }

  /**
   * Unwraps a tree row's solution-row payload.
   * @param row The tree row.
   * @returns Returns the solution row.
   */
  protected rowOf(row: TreeRow): SolutionRow {
    return row.data as SolutionRow;
  }

  /**
   * Updates the search query from the toolbar's search box.
   * @param value The new search query.
   */
  protected onSearch(value: string): void {
    this.solution.setQuery(value);
  }

  /**
   * Expands every node in the tree.
   */
  protected expandAll(): void {
    this.log.info('workspace.solution', 'Expand all requested');
    this.solution.expandAll();
  }

  /**
   * Collapses every node in the tree, keeping the solution root expanded.
   */
  protected collapseAll(): void {
    this.log.info('workspace.solution', 'Collapse all requested');
    this.solution.collapseAll();
  }

  /**
   * Runs a toolbar overflow action.
   * @param id The chosen action.
   */
  public onMoreAction(id: string): void {
    this.log.info('workspace.solution', 'Toolbar action', id);
    switch (id) {
      case ACTION_FOLLOW:
        this.solution.toggleFollowActiveDocument();
        return;
      case ACTION_GIT_STATUS:
        this.solution.toggleGitStatus();
        return;
      case ACTION_OPEN_ROOT: {
        const root: string | undefined = this.model()?.root;
        if (root !== undefined) {
          void this.shell.openPath(root);
        }
        return;
      }
      case ACTION_RELOAD:
        this.solution.refreshFromDisk();
        return;
      default:
        return;
    }
  }

  /**
   * Runs a row's context-menu action.
   * @param selection The chosen item and the row it was chosen for.
   */
  public onContextAction(selection: TreeMenuSelection): void {
    const targets: readonly SolutionRow[] = this.targetsOf(selection.row);
    if (targets.length > 1) {
      this.runOnSelection(selection.itemId, targets);
      return;
    }
    const row: SolutionRow = this.rowOf(selection.row);
    if (selection.itemId.startsWith(PROJECT_ACTION_PREFIX)) {
      this.requestProjectAction(selection.itemId.slice(PROJECT_ACTION_PREFIX.length), row);
      return;
    }
    if (selection.itemId === ACTION_RENAME_FOLDER) {
      this.beginRename(row);
      return;
    }
    const path: string | null = this.pathFor(row);
    if (path === null) {
      return;
    }
    this.log.info('workspace.solution', 'Context action', selection.itemId, path);
    if (this.vcsMenu.run(selection.itemId, [this.vcsTarget(row, path)])) {
      return;
    }

    switch (selection.itemId) {
      case ACTION_OPEN:
      case ACTION_EDIT_PROJECT:
        this.solution.select(row.key);
        void this.fileOpener.openPath(path);
        return;
      case ACTION_COPY_PATH:
        void navigator.clipboard.writeText(path).catch((): void => undefined);
        return;
      case ACTION_COPY_RELATIVE:
        void navigator.clipboard.writeText(this.relativePath(path)).catch((): void => undefined);
        return;
      case ACTION_REVEAL:
        void this.shell.revealPath(path);
        return;
      default:
        return;
    }
  }

  /**
   * Gets the rows a command chosen on a row acts on: the selection, when the row is part of it,
   * otherwise the row alone.
   * @param treeRow The row the command was chosen on.
   * @returns Returns the rows, in the order the tree shows them.
   */
  private targetsOf(treeRow: TreeRow): readonly SolutionRow[] {
    const byKey: ReadonlyMap<string, SolutionRow> = new Map<string, SolutionRow>(
      this.solution.rows().map((row: SolutionRow): [string, SolutionRow] => [row.key, row]),
    );
    const targets: readonly SolutionRow[] = this.selection
      .targetsFor(treeRow.id, this.visibleOrder())
      .map((key: string): SolutionRow | undefined => byKey.get(key))
      .filter((row: SolutionRow | undefined): row is SolutionRow => row !== undefined);
    return targets.length === 0 ? [this.rowOf(treeRow)] : targets;
  }

  /**
   * Gets every visible row's key, in order — the order a selection is kept and acted on in.
   * @returns Returns the keys.
   */
  private visibleOrder(): readonly string[] {
    return this.rows().map((row: TreeRow): string => row.id);
  }

  /**
   * Builds the menu for several selected rows (#1048): only what acts on every one of them — Open when
   * they are all files, the path copies (one path per line) and the version-control commands they all
   * take. A row standing for nothing on disk (a solution folder) leaves a selection holding it with no
   * menu, as it has none of its own; project actions, Rename and Edit Project File need one row.
   * @param targets The selected rows.
   * @returns Returns the items.
   */
  private selectionItems(targets: readonly SolutionRow[]): readonly MenuItem[] {
    const paths: readonly (string | null)[] = targets.map((row: SolutionRow): string | null =>
      this.pathFor(row),
    );
    if (paths.some((path: string | null): boolean => path === null)) {
      return [];
    }
    const items: MenuItem[] = [];
    if (targets.every((row: SolutionRow): boolean => row.kind === 'file')) {
      items.push({ id: ACTION_OPEN, label: 'Open', icon: Icon.FILE });
    }
    items.push(
      { id: ACTION_COPY_PATH, label: 'Copy Paths', icon: Icon.COPY },
      { id: ACTION_COPY_RELATIVE, label: 'Copy Relative Paths', icon: Icon.COPY },
    );
    const vcs: readonly MenuItem[] = this.vcsMenu.itemsFor(this.vcsTargets(targets));
    if (vcs.length > 0) {
      items.push({ id: 'solution-menu.sep-vcs', label: '', separator: true }, ...vcs);
    }
    return items;
  }

  /**
   * Runs a command chosen for several selected rows (#1048).
   * @param itemId The chosen item.
   * @param targets The selected rows.
   */
  private runOnSelection(itemId: string, targets: readonly SolutionRow[]): void {
    const paths: readonly string[] = targets
      .map((row: SolutionRow): string | null => this.pathFor(row))
      .filter((path: string | null): path is string => path !== null);
    if (paths.length !== targets.length) {
      return;
    }
    if (this.vcsMenu.run(itemId, this.vcsTargets(targets))) {
      return;
    }
    switch (itemId) {
      case ACTION_OPEN:
        for (const path of paths) {
          void this.fileOpener.openPath(path);
        }
        return;
      case ACTION_COPY_PATH:
        void navigator.clipboard.writeText(paths.join('\n')).catch((): void => undefined);
        return;
      case ACTION_COPY_RELATIVE:
        void navigator.clipboard
          .writeText(paths.map((path: string): string => this.relativePath(path)).join('\n'))
          .catch((): void => undefined);
        return;
      default:
        return;
    }
  }

  /**
   * Describes rows with paths to the version-control commands.
   * @param rows The rows; each must stand for a path.
   * @returns Returns the targets.
   */
  private vcsTargets(rows: readonly SolutionRow[]): readonly ExplorerVcsTarget[] {
    return rows.flatMap((row: SolutionRow): readonly ExplorerVcsTarget[] => {
      const path: string | null = this.pathFor(row);
      return path === null ? [] : [this.vcsTarget(row, path)];
    });
  }

  /**
   * Describes a row to the version-control commands. A folder row, and the root row (which stands for
   * the root directory), act as folders. A project row — and a solution row backed by its `.sln` —
   * acts on the file it is read from, so it is named by that file rather than by its label: Revert
   * on project "A" reverts `A.csproj`, and the confirmation should say so.
   * @param row The row.
   * @param path The row's path.
   * @returns Returns the target.
   */
  private vcsTarget(row: SolutionRow, path: string): ExplorerVcsTarget {
    if (row.kind === 'item-folder' || row.path === null) {
      return { path, name: row.label, kind: 'directory' };
    }
    const name: string = row.kind === 'file' ? row.label : (path.split(/[/\\]/).pop() ?? row.label);
    return { path, name, kind: 'file' };
  }

  /**
   * Runs a capability action against the row's project, or — when the Build terminal is busy — asks
   * whether to stop the running build and start this one instead.
   *
   * The verb arrives as the tail of a menu id, so it is checked against the offered actions rather
   * than trusted: an id that names no offered verb, or a row that resolves to no project, does
   * nothing.
   * @param verb The action's name, taken from the chosen menu id.
   * @param row The row the action was chosen for.
   */
  private requestProjectAction(verb: string, row: SolutionRow): void {
    const candidate: { action: ProjectAction; label: string; icon: Icon } | undefined =
      PROJECT_ACTIONS.find((entry: { action: ProjectAction }): boolean => entry.action === verb);
    const project: ProjectEntry | null = this.projectFor(row);
    if (candidate === undefined || project === null) {
      return;
    }
    this.solution.select(row.key);
    const pending: PendingProjectAction = {
      action: candidate.action,
      label: candidate.label,
      project,
    };
    if (this.buildRunner.buildBusy()) {
      this.pendingAction.set(pending);
      return;
    }
    this.dispatchProjectAction(pending, false);
  }

  /**
   * Confirms the stop-and-restart prompt: the running build is stopped and the pending action starts
   * against its project in its place.
   */
  public confirmProjectActionRestart(): void {
    const pending: PendingProjectAction | null = this.pendingAction();
    this.pendingAction.set(null);
    if (pending !== null) {
      this.dispatchProjectAction(pending, true);
    }
  }

  /**
   * Dismisses the stop-and-restart prompt, leaving the running build untouched.
   */
  public cancelProjectActionRestart(): void {
    this.pendingAction.set(null);
  }

  /**
   * Sends a capability action to this workspace's build runner, aimed at one project.
   * @param pending The action and the project it runs against.
   * @param restart Whether a busy build may be stopped and replaced.
   */
  private dispatchProjectAction(pending: PendingProjectAction, restart: boolean): void {
    this.log.info(
      'workspace.solution',
      `Project action '${pending.action}'`,
      pending.project.path,
      { restart },
    );
    this.buildRunner.runAction(pending.action, { project: pending.project, restart });
  }

  /**
   * Expresses a path relative to the solution root, falling back to the absolute path when it lies
   * outside (a linked file, which project systems do allow).
   * @param path The absolute path.
   * @returns Returns the relative path, or the absolute path when it is not beneath the root.
   */
  private relativePath(path: string): string {
    const root: string | undefined = this.model()?.root;
    if (root === undefined || !path.startsWith(root)) {
      return path;
    }
    return path.slice(root.length).replace(/^[/\\]+/, '');
  }

  /**
   * Resolves a row's icon by its kind and expansion.
   * @param row The row to resolve an icon for.
   * @returns Returns the row's icon.
   */
  public iconFor(row: SolutionRow): Icon {
    switch (row.kind) {
      case 'solution':
        return Icon.SOLUTION_EXPLORER;
      case 'project':
        return Icon.PROJECT;
      case 'folder':
      case 'item-folder':
        // Always a real folder, open or closed. A folder waiting on its projects used to read as a
        // DASHED folder, which said the wrong thing — it is not a different kind of folder, it is the
        // same folder that has not arrived — and it made the tree change shape twice per project as
        // each one loaded in turn. Not-ready is carried by the row's disabled state instead.
        return row.expanded ? Icon.FOLDER_OPEN : Icon.DIRECTORY;
      default:
        return this.fileIconFor(row.label);
    }
  }

  /**
   * Clears the selection, after a click on the tree's empty space.
   */
  public clearSelection(): void {
    this.solution.clearSelection();
  }

  /**
   * Handles a plain click on a row: toggles an expandable row. Selecting is {@link onRowSelect}'s, and a
   * file is only selected — double click or Enter opens it (#1047). A still-loading project is inert
   * until its contents arrive.
   * @param treeRow The tree row that was clicked.
   */
  public onRowClick(treeRow: TreeRow): void {
    const row: SolutionRow = this.rowOf(treeRow);
    if (row.loading) {
      return;
    }
    if (row.expandable) {
      this.log.debug('workspace.solution', `Toggle ${row.kind} row`, row.key);
      this.solution.toggle(row);
    }
  }

  /**
   * Applies a selection gesture — a click, ⌘- or Shift-click, an arrow key — and makes the row it
   * landed on the selected row (#1048).
   * @param gesture The gesture.
   */
  public onRowSelect(gesture: TreeSelectGesture): void {
    this.selection.apply(gesture.row.id, gesture.mode, this.visibleOrder());
    this.syncSelectedKey();
  }

  /**
   * Selects every visible row, for ⌘A in the tree (#1048).
   */
  public onSelectAll(): void {
    this.selection.selectAll(this.visibleOrder());
    this.syncSelectedKey();
  }

  /**
   * Makes the row last acted on the solution model's selected row, or clears it.
   */
  private syncSelectedKey(): void {
    const focused: string | null = this.selection.focused();
    if (focused === null) {
      this.solution.clearSelection();
    } else {
      this.solution.select(focused);
    }
  }

  /**
   * Opens a file row — on a double click, or Enter (#1047). Rows that expand open nothing: their clicks
   * already toggled them, and a project's file has its own Edit Project File.
   * @param treeRow The row to open.
   */
  public onRowOpen(treeRow: TreeRow): void {
    const row: SolutionRow = this.rowOf(treeRow);
    if (row.loading || row.expandable || row.path === null) {
      return;
    }
    this.log.info('workspace.solution', 'Open file from solution', row.path);
    void this.fileOpener.openPath(row.path);
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
