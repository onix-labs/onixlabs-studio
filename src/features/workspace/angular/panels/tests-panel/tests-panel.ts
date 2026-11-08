import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { CdkMenuTrigger } from '@angular/cdk/menu';
import type { TestLocation, TestNodeKind, TestStackFrame } from '@shared/api/test-adapter-protocol';
import type { TestAdapterInfo } from '@shared/api/test-channels';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { EditorNavigation } from '@shared/angular/services/references/editor-navigation';
import { Log } from '@shared/angular/services/log/log';
import { Icon } from '@shared/angular/icons/icon';
import { fileIconFor } from '@shared/angular/icons/file-icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Chip } from '@shared/angular/components/chip/chip';
import { Button } from '@shared/angular/components/forms/button/button';
import { Menu, MenuItem } from '@shared/angular/components/menu/menu';
import { PanelToolbar } from '@shared/angular/components/panel-toolbar/panel-toolbar';
import { PanelStatus } from '@shared/angular/components/panel-status/panel-status';
import {
  TreeMenuSelection,
  TreeRow,
  TreeView,
} from '@shared/angular/components/tree-view/tree-view';
import {
  TestAdapterProblem,
  TestExplorer,
  TestExplorerPhase,
} from '@features/workspace/angular/tests/test-explorer';
import {
  formatDuration,
  layoutRows,
  TestEntry,
  TestRow,
  TestRowData,
  TestState,
  TestStatus,
  TestTotals,
  totals,
} from '@features/workspace/angular/tests/test-tree';

/**
 * The icon each status wears in the tree. A node with no result yet shows its kind's icon instead.
 */
const STATUS_ICONS: Readonly<Record<Exclude<TestStatus, 'none'>, Icon>> = {
  passed: Icon.TEST_PASSED,
  failed: Icon.TEST_FAILED,
  errored: Icon.TEST_ERRORED,
  skipped: Icon.TEST_SKIPPED,
  running: Icon.SPINNER,
  queued: Icon.TEST_QUEUED,
};

/**
 * The words each status reads as, for a row's tooltip and the detail column.
 */
const STATUS_WORDS: Readonly<Record<TestStatus, string>> = {
  passed: 'Passed',
  failed: 'Failed',
  errored: 'Could not run',
  skipped: 'Skipped',
  running: 'Running',
  queued: 'Waiting to run',
  none: 'Not run',
};

/**
 * Identifies the row menu's Run command.
 */
const ROW_RUN: string = 'tests.row.run';

/**
 * Identifies the row menu's Debug command.
 */
const ROW_DEBUG: string = 'tests.row.debug';

/**
 * Identifies the row menu's Go to Test command.
 */
const ROW_GO_TO: string = 'tests.row.go-to';

/**
 * Identifies the "…" menu's Refresh Tests command.
 */
const MENU_REFRESH: string = 'tests.refresh';

/**
 * Identifies the "…" menu's Show Run Output command.
 */
const MENU_OUTPUT: string = 'tests.output';

/**
 * Identifies the "…" menu's Show Only Failed toggle.
 */
const MENU_FAILED_ONLY: string = 'tests.failed-only';

/**
 * Renders the Tests dock panel (#1352): every test the workspace's installed test adapters found, as a
 * tree of project → file or class → test, with how each last came out. Its tool strip runs all, re-runs
 * what failed, debugs the selected test and stops a run; a row's menu runs, debugs or opens one node;
 * the column beside the tree shows the selected test's failure, stack and output, the stack linking
 * into the editor.
 *
 * ⛔ Core UI only. Everything it shows comes from the test-adapter slot (#1351) through
 * {@link TestExplorer}; it names no framework.
 */
@Component({
  selector: 'app-tests-panel',
  imports: [AppIcon, Button, CdkMenuTrigger, Chip, Menu, PanelStatus, PanelToolbar, TreeView],
  templateUrl: './tests-panel.html',
  styleUrl: './tests-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TestsPanel {
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
   * Holds the workspace's tests and runs.
   */
  protected readonly explorer: TestExplorer = inject(TestExplorer);

  /**
   * Holds the editor navigation, for links into the source.
   */
  private readonly navigation: EditorNavigation = inject(EditorNavigation);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the keys of the folded groups.
   */
  private readonly collapsed: WritableSignal<ReadonlySet<string>> = signal<ReadonlySet<string>>(
    new Set<string>(),
  );

  /**
   * Holds whether only failed tests are shown.
   */
  protected readonly failedOnly: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the selected row's key.
   */
  protected readonly selectedKey: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Gets what the explorer is doing.
   */
  protected readonly phase: Signal<TestExplorerPhase> = this.explorer.phase;

  /**
   * Gets the drawn rows.
   */
  protected readonly rows: Signal<readonly TestRow[]> = computed((): readonly TestRow[] =>
    layoutRows(
      this.explorer.index(),
      this.explorer.states(),
      this.explorer.running(),
      this.explorer.queued(),
      { collapsed: this.collapsed(), failedOnly: this.failedOnly() },
    ),
  );

  /**
   * Gets the rows as the shared tree takes them.
   */
  protected readonly treeRows: Signal<readonly TreeRow[]> = computed((): readonly TreeRow[] =>
    this.rows().map((row: TestRow): TreeRow => ({
      id: row.key,
      depth: row.depth,
      expandable: row.expandable,
      expanded: row.expanded,
      data: row.data,
    })),
  );

  /**
   * Gets the tallies for the status strip.
   */
  protected readonly totals: Signal<TestTotals> = computed((): TestTotals =>
    totals(this.explorer.index(), this.explorer.states()),
  );

  /**
   * Gets the selected node, when it is still in the tree.
   */
  protected readonly selected: Signal<TestEntry | null> = computed((): TestEntry | null => {
    const key: string | null = this.selectedKey();
    return key === null ? null : (this.explorer.index().get(key) ?? null);
  });

  /**
   * Gets the selected test's last state, when it is a test that has run.
   */
  protected readonly selectedState: Signal<TestState | null> = computed((): TestState | null => {
    const entry: TestEntry | null = this.selected();
    return entry === null ? null : (this.explorer.states().get(entry.key) ?? null);
  });

  /**
   * Gets the icon the detail column's title wears: the selected node's outcome, or its kind's.
   */
  protected readonly selectedIcon: Signal<Icon> = computed((): Icon => {
    const entry: TestEntry | null = this.selected();
    const state: TestState | null = this.selectedState();
    if (entry === null) {
      return Icon.TEST;
    }
    return state === null
      ? kindIcon(entry.node.kind, entry.node.location)
      : STATUS_ICONS[state.outcome];
  });

  /**
   * Gets the selected test's stack as rows of the shared tree, each linking where it can.
   */
  protected readonly stackRows: Signal<readonly TreeRow[]> = computed((): readonly TreeRow[] =>
    (this.selectedState()?.stack ?? []).map((frame: TestStackFrame, index: number): TreeRow => ({
      id: `frame:${index}`,
      depth: 0,
      expandable: false,
      expanded: false,
      disabled: frame.location === undefined,
      data: frame,
    })),
  );

  /**
   * Gets whether the selected node can be debugged: one test whose adapter debugs.
   */
  protected readonly canDebugSelected: Signal<boolean> = computed((): boolean => {
    const entry: TestEntry | null = this.selected();
    return (
      entry?.node.kind === 'test' &&
      this.explorer.can(entry.pluginId, 'debug') &&
      this.phase() === 'idle'
    );
  });

  /**
   * Gets the adapters that apply but are not installed, for the empty state's offer.
   */
  protected readonly missing: Signal<readonly TestAdapterInfo[]> = computed(
    (): readonly TestAdapterInfo[] =>
      this.explorer.adapters().filter((adapter: TestAdapterInfo): boolean => !adapter.installed),
  );

  /**
   * Gets the first reason an installed adapter has no tree, for the empty state.
   */
  protected readonly problem: Signal<TestAdapterProblem | null> = computed(
    (): TestAdapterProblem | null => [...this.explorer.problems().values()][0] ?? null,
  );

  /**
   * Gets the "…" menu's rows.
   */
  protected readonly menuItems: Signal<readonly MenuItem[]> = computed((): readonly MenuItem[] => [
    {
      id: MENU_REFRESH,
      label: 'Refresh Tests',
      icon: Icon.REFRESH,
      disabled: this.phase() !== 'idle',
    },
    {
      id: MENU_OUTPUT,
      label: 'Show Run Output',
      icon: Icon.TERMINAL,
      disabled: !this.explorer.hasOutput(),
    },
    { id: 'tests.separator', label: '', separator: true },
    { id: MENU_FAILED_ONLY, label: 'Show Only Failed Tests', checked: this.failedOnly() },
  ]);

  /**
   * Builds a row's context menu: Run, Debug for a test whose adapter debugs, and Go to Test where it
   * is declared. ⛔ No tones, no ellipses.
   */
  protected readonly rowMenu: (row: TreeRow) => readonly MenuItem[] = (
    row: TreeRow,
  ): readonly MenuItem[] => {
    const data: TestRowData = row.data as TestRowData;
    const idle: boolean = this.phase() === 'idle';
    const items: MenuItem[] = [
      {
        id: ROW_RUN,
        label: data.entry.node.kind === 'test' ? 'Run Test' : 'Run Tests',
        icon: Icon.PLAY,
        disabled: !idle,
      },
    ];
    if (data.entry.node.kind === 'test' && this.explorer.can(data.entry.pluginId, 'debug')) {
      items.push({ id: ROW_DEBUG, label: 'Debug Test', icon: Icon.DEBUG, disabled: !idle });
    }
    if (data.entry.node.location !== undefined) {
      items.push({ id: ROW_GO_TO, label: 'Go to Test', icon: Icon.OPEN_FILE });
    }
    return items;
  };

  /**
   * Runs every test.
   */
  protected runAll(): void {
    this.log.info('workspace.tests', 'Run all tests');
    void this.explorer.runAll();
  }

  /**
   * Runs the tests that failed last time.
   */
  protected runFailed(): void {
    this.log.info('workspace.tests', 'Run failed tests');
    void this.explorer.runFailed();
  }

  /**
   * Debugs the selected test.
   */
  protected debugSelected(): void {
    const entry: TestEntry | null = this.selected();
    if (entry !== null) {
      void this.explorer.debug(entry.key);
    }
  }

  /**
   * Stops the run.
   */
  protected stop(): void {
    this.explorer.stop();
  }

  /**
   * Unfolds every group.
   */
  protected expandAll(): void {
    this.collapsed.set(new Set<string>());
  }

  /**
   * Folds every root.
   */
  protected collapseAll(): void {
    this.collapsed.set(
      new Set<string>(
        [...this.explorer.index().values()]
          .filter((entry: TestEntry): boolean => (entry.node.children?.length ?? 0) > 0)
          .map((entry: TestEntry): string => entry.key),
      ),
    );
  }

  /**
   * Runs a "…" menu row.
   * @param id The row's identifier.
   */
  protected onMenu(id: string): void {
    switch (id) {
      case MENU_REFRESH:
        void this.explorer.refresh();
        break;
      case MENU_OUTPUT:
        this.explorer.showOutput();
        break;
      case MENU_FAILED_ONLY:
        this.failedOnly.update((value: boolean): boolean => !value);
        break;
    }
  }

  /**
   * Selects a row; a group also folds or unfolds.
   * @param row The row.
   */
  protected onRowClick(row: TreeRow): void {
    this.selectedKey.set(row.id);
    if (row.expandable) {
      this.collapsed.update((current: ReadonlySet<string>): ReadonlySet<string> => {
        const next: Set<string> = new Set<string>(current);
        if (!next.delete(row.id)) {
          next.add(row.id);
        }
        return next;
      });
    }
  }

  /**
   * Opens a row's declaration.
   * @param row The row.
   */
  protected onRowDoubleClick(row: TreeRow): void {
    const location: TestLocation | undefined = (row.data as TestRowData).entry.node.location;
    if (location !== undefined) {
      this.open(location);
    }
  }

  /**
   * Runs a row menu command.
   * @param selection The command and the row it was opened on.
   */
  protected onRowMenu(selection: TreeMenuSelection): void {
    const data: TestRowData = selection.row.data as TestRowData;
    switch (selection.itemId) {
      case ROW_RUN:
        void this.explorer.run([data.entry.key]);
        break;
      case ROW_DEBUG:
        void this.explorer.debug(data.entry.key);
        break;
      case ROW_GO_TO:
        if (data.entry.node.location !== undefined) {
          this.open(data.entry.node.location);
        }
        break;
    }
  }

  /**
   * Opens the place a stack frame points at.
   * @param row The frame's row.
   */
  protected onFrameClick(row: TreeRow): void {
    const location: TestLocation | undefined = (row.data as TestStackFrame).location;
    if (location !== undefined) {
      this.open(location);
    }
  }

  /**
   * Unwraps a row's payload.
   * @param row The row.
   * @returns Returns what it shows.
   */
  protected rowOf(row: TreeRow): TestRowData {
    return row.data as TestRowData;
  }

  /**
   * Unwraps a stack row's frame.
   * @param row The row.
   * @returns Returns the frame.
   */
  protected frameOf(row: TreeRow): TestStackFrame {
    return row.data as TestStackFrame;
  }

  /**
   * Gets the icon a row wears: its status once it has one, else its kind's.
   * @param data The row.
   * @returns Returns the icon.
   */
  protected iconOf(data: TestRowData): Icon {
    if (data.status !== 'none') {
      return STATUS_ICONS[data.status];
    }
    return kindIcon(data.entry.node.kind, data.entry.node.location);
  }

  /**
   * Gets the words a status reads as.
   * @param status The status.
   * @returns Returns the words.
   */
  protected wordsOf(status: TestStatus): string {
    return STATUS_WORDS[status];
  }

  /**
   * Formats a duration.
   * @param ms The duration.
   * @returns Returns the text.
   */
  protected duration(ms: number | undefined): string {
    return formatDuration(ms);
  }

  /**
   * Names the frameworks of adapters that apply but are not installed.
   * @param adapters The adapters.
   * @returns Returns the names, such as `xUnit, NUnit or MSTest`.
   */
  protected frameworksOf(adapters: readonly TestAdapterInfo[]): string {
    const names: readonly string[] = [
      ...new Set<string>(adapters.flatMap((adapter: TestAdapterInfo) => adapter.frameworks)),
    ];
    return names.length <= 1
      ? (names[0] ?? '')
      : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
  }

  /**
   * Names adapters, for the empty state's offer.
   * @param adapters The adapters.
   * @returns Returns the names, joined.
   */
  protected namesOf(adapters: readonly TestAdapterInfo[]): string {
    return adapters.map((adapter: TestAdapterInfo): string => adapter.displayName).join(' and ');
  }

  /**
   * Opens a source location in the editor.
   * @param location The location.
   */
  private open(location: TestLocation): void {
    void this.navigation.goTo(null, {
      path: location.file,
      range: {
        startLineNumber: location.line,
        startColumn: 1,
        endLineNumber: location.line,
        endColumn: 1,
      },
    });
  }
}

/**
 * Gets a node kind's icon, for a node that has not run.
 * @param kind The kind.
 * @param location Where it is declared, for a file's icon.
 * @returns Returns the icon.
 */
function kindIcon(kind: TestNodeKind, location: TestLocation | undefined): Icon {
  switch (kind) {
    case 'project':
      return Icon.PROJECT;
    case 'file':
      return location === undefined ? Icon.TEST : fileIconFor(location.file);
    case 'suite':
      return Icon.SYMBOL_CLASS;
    default:
      return Icon.TEST_NOT_RUN;
  }
}
