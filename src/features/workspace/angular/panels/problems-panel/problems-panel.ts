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
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import {
  Diagnostic,
  DiagnosticSeverity,
  Diagnostics,
} from '@shared/angular/services/diagnostics/diagnostics';
import { Editors } from '@shared/angular/services/editors/editors';
import { EditorNavigation } from '@shared/angular/services/references/editor-navigation';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { Log } from '@shared/angular/services/log/log';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Chip } from '@shared/angular/components/chip/chip';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { PanelToolbar } from '@shared/angular/components/panel-toolbar/panel-toolbar';
import { Button } from '@shared/angular/components/forms/button/button';
import { TreeRow, TreeView } from '@shared/angular/components/tree-view/tree-view';
import { fileIconFor } from '@shared/angular/icons/file-icon';
import { ActiveWorkspace } from '@shared/angular/services/workspace/active-workspace';
import { SolutionModel } from '@features/workspace/angular/project/solution-model';
import {
  groupProblems,
  OTHER_FILES,
  ProblemFileGroup,
  ProblemProjectGroup,
} from './problems-grouping';

/**
 * Maps each severity to its icon.
 */
const SEVERITY_ICONS: Readonly<Record<DiagnosticSeverity, Icon>> = {
  error: Icon.ERROR,
  warning: Icon.WARNING,
  info: Icon.INFO,
  hint: Icon.HINT,
};

/**
 * The severity filter selection: everything, or only one severity.
 */
type SeverityFilter = 'all' | DiagnosticSeverity;

/**
 * The source value used for "all sources" in the source filter.
 */
const ALL_SOURCES: string = '';

/**
 * The most problem rows rendered at once. A large solution mid-analysis can hold many thousands of
 * diagnostics; past this the list adds no navigational value — the filters are the tool — and every
 * row past it is pure DOM cost.
 */
const MAX_RENDERED_PROBLEMS: number = 1000;

/**
 * A severity filter option shown as a toggle button in the tool-strip.
 */
interface SeverityOption {
  /**
   * The filter value this button selects.
   */
  readonly value: SeverityFilter;

  /**
   * The button label.
   */
  readonly label: string;

  /**
   * The button icon.
   */
  readonly icon: Icon;
}

/**
 * The severity filter options shown as toggle buttons in the tool-strip.
 */
const SEVERITY_OPTIONS: readonly SeverityOption[] = [
  { value: 'all', label: 'Everything', icon: Icon.LIST_ALL },
  { value: 'error', label: 'Errors', icon: Icon.ERROR },
  { value: 'warning', label: 'Warnings', icon: Icon.WARNING },
];

/**
 * Renders the aggregated {@link Diagnostics} as the body of the Problems (Error List) dock panel: a
 * tool-strip that filters by severity and source over a severity-sorted list of file/line/message rows,
 * with an error/warning summary. The dock chrome supplies the title bar. Fed uniformly by every
 * provider behind the {@link Diagnostics} seam (Monaco markers, each language server, build problems)
 * with no per-language special-casing.
 */
/**
 * Describes what a row of the grouped Error List shows (#1182).
 */
type ProblemRow =
  | { readonly kind: 'project'; readonly project: ProblemProjectGroup }
  | { readonly kind: 'file'; readonly file: ProblemFileGroup }
  | { readonly kind: 'problem'; readonly problem: Diagnostic };

@Component({
  selector: 'app-problems-panel',
  imports: [Chip, Button, AppIcon, Dropdown, PanelToolbar, TreeView],
  templateUrl: './problems-panel.html',
  styleUrl: './problems-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProblemsPanel {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the severity filter options rendered as toggle buttons.
   */
  protected readonly severityOptions: readonly SeverityOption[] = SEVERITY_OPTIONS;

  /**
   * Gets the dock panel descriptor this body renders. Supplied by the dock outlet, which sets it on
   * every projected panel component; unused here because the dock chrome renders the title.
   */
  public readonly panel: InputSignal<DockPanel> = input.required<DockPanel>();

  /**
   * Gets the diagnostics aggregate rendered by this panel.
   */
  public readonly diagnostics: Diagnostics = inject(Diagnostics);

  /**
   * Holds the file opener used to activate the document a diagnostic belongs to.
   */
  private readonly fileOpener: FileOpener = inject(FileOpener);

  /**
   * Holds the editor registry used to reveal the diagnostic's line in its editor.
   */
  private readonly editors: Editors = inject(Editors);

  /**
   * Holds the navigation that opens a file and places the caret once its editor has registered, for a
   * problem in a file that is not open (#1144).
   */
  private readonly navigation: EditorNavigation = inject(EditorNavigation);

  /**
   * Holds the structured logger for problems panel actions.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the workspace's project model, which says which project owns a file (#1182).
   */
  private readonly solution: SolutionModel = inject(SolutionModel);

  /**
   * Holds the active workspace, whose root a file no project owns is named relative to.
   */
  private readonly activeWorkspace: ActiveWorkspace = inject(ActiveWorkspace);

  /**
   * Holds whether the list is grouped by project and file (#1182), or flat.
   */
  protected readonly grouped: WritableSignal<boolean> = signal<boolean>(true);

  /**
   * Holds the groups folded, by row id. Every group starts open.
   */
  private readonly collapsed: WritableSignal<ReadonlySet<string>> = signal<ReadonlySet<string>>(
    new Set<string>(),
  );

  /**
   * Holds the problem row last chosen.
   */
  protected readonly selectedId: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds the selected severity filter.
   */
  protected readonly severity: WritableSignal<SeverityFilter> = signal<SeverityFilter>('all');

  /**
   * Holds the selected source filter, or {@link ALL_SOURCES} for every source.
   */
  protected readonly source: WritableSignal<string> = signal<string>(ALL_SOURCES);

  /**
   * Gets the distinct diagnostic sources as dropdown options, prefixed with an "all sources" entry.
   * Hidden by the template when only one source is present.
   */
  protected readonly sourceOptions: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] => {
      const sources: string[] = [
        ...new Set<string>(
          this.diagnostics
            .all()
            .map((diagnostic: Diagnostic): string => diagnostic.source)
            .filter((value: string): boolean => value.length > 0),
        ),
      ].sort((a: string, b: string): number => a.localeCompare(b));
      return [
        { value: ALL_SOURCES, label: 'All sources' },
        ...sources.map((value: string): DropdownOption => ({ value, label: value })),
      ];
    },
  );

  /**
   * Gets the diagnostics after applying the severity and source filters.
   */
  protected readonly filtered: Signal<readonly Diagnostic[]> = computed(
    (): readonly Diagnostic[] => {
      const severity: SeverityFilter = this.severity();
      const source: string = this.source();
      return this.diagnostics
        .all()
        .filter(
          (diagnostic: Diagnostic): boolean =>
            (severity === 'all' || diagnostic.severity === severity) &&
            (source === ALL_SOURCES || diagnostic.source === source),
        );
    },
  );

  /**
   * Gets the filtered diagnostics actually rendered, capped so a large solution's thousands of
   * problems cannot materialise thousands of DOM rows; the toolbar counts still reflect the full
   * set, and {@link overflowCount} tells the user what the list is holding back.
   */
  protected readonly visible: Signal<readonly Diagnostic[]> = computed((): readonly Diagnostic[] =>
    this.filtered().slice(0, MAX_RENDERED_PROBLEMS),
  );

  /**
   * Gets how many filtered diagnostics are beyond the rendered cap.
   */
  protected readonly overflowCount: Signal<number> = computed((): number =>
    Math.max(0, this.filtered().length - MAX_RENDERED_PROBLEMS),
  );

  /**
   * Gets the rendered problems grouped by project, then file (#1182).
   */
  protected readonly groups: Signal<readonly ProblemProjectGroup[]> = computed(
    (): readonly ProblemProjectGroup[] =>
      groupProblems(
        this.visible(),
        (path: string) => this.solution.owningProject(path),
        this.activeWorkspace.rootPath(),
      ),
  );

  /**
   * Gets the grouped view's rows: each project, each of its files, and each file's problems — without
   * the project level in a workspace with no projects — folded groups hiding what is beneath them.
   */
  protected readonly treeRows: Signal<readonly TreeRow[]> = computed((): readonly TreeRow[] => {
    const groups: readonly ProblemProjectGroup[] = this.groups();
    const collapsed: ReadonlySet<string> = this.collapsed();
    const projectLevel: boolean = !(groups.length === 1 && groups[0]?.key === OTHER_FILES);
    const rows: TreeRow[] = [];
    for (const project of groups) {
      const projectId: string = `project:${project.key}`;
      if (projectLevel) {
        rows.push({
          id: projectId,
          depth: 0,
          expandable: true,
          expanded: !collapsed.has(projectId),
          data: { kind: 'project', project } satisfies ProblemRow,
        });
        if (collapsed.has(projectId)) {
          continue;
        }
      }
      const fileDepth: number = projectLevel ? 1 : 0;
      for (const file of project.files) {
        const fileId: string = `file:${project.key}:${file.key}`;
        rows.push({
          id: fileId,
          depth: fileDepth,
          expandable: true,
          expanded: !collapsed.has(fileId),
          hint: file.key,
          data: { kind: 'file', file } satisfies ProblemRow,
        });
        if (collapsed.has(fileId)) {
          continue;
        }
        file.problems.forEach((problem: Diagnostic, index: number): void => {
          rows.push({
            id: `${fileId}:${index}`,
            depth: fileDepth + 1,
            expandable: false,
            expanded: false,
            data: { kind: 'problem', problem } satisfies ProblemRow,
          });
        });
      }
    }
    return rows;
  });

  /**
   * Switches between the grouped and the flat list.
   */
  protected toggleGrouped(): void {
    this.grouped.update((grouped: boolean): boolean => !grouped);
    this.log.debug('workspace.problems', 'Group by project and file', this.grouped());
  }

  /**
   * Unfolds every group.
   */
  protected expandAll(): void {
    this.collapsed.set(new Set<string>());
  }

  /**
   * Folds every project — or, with no project level, every file.
   */
  protected collapseAll(): void {
    this.collapsed.set(
      new Set<string>(
        this.treeRows()
          .filter((row: TreeRow): boolean => row.depth === 0 && row.expandable)
          .map((row: TreeRow): string => row.id),
      ),
    );
  }

  /**
   * Handles a chosen row in the grouped list: a problem is revealed, a group folds or unfolds.
   * @param row The row.
   */
  protected onRowClick(row: TreeRow): void {
    const entry: ProblemRow = this.rowOf(row);
    if (entry.kind === 'problem') {
      this.selectedId.set(row.id);
      this.reveal(entry.problem);
      return;
    }
    this.collapsed.update((current: ReadonlySet<string>): ReadonlySet<string> => {
      const next: Set<string> = new Set<string>(current);
      if (!next.delete(row.id)) {
        next.add(row.id);
      }
      return next;
    });
  }

  /**
   * Unwraps a grouped row's payload.
   * @param row The tree row.
   * @returns Returns what it shows.
   */
  protected rowOf(row: TreeRow): ProblemRow {
    return row.data as ProblemRow;
  }

  /**
   * Gets a file group's icon.
   * @param file The file group.
   * @returns Returns the icon of its file type.
   */
  protected fileIcon(file: ProblemFileGroup): Icon {
    return fileIconFor(file.label);
  }

  /**
   * Determines whether a problem can be revealed: it is in a file, or in an open document.
   * @param diagnostic The problem.
   * @returns Returns true when it can.
   */
  protected revealable(diagnostic: Diagnostic): boolean {
    return diagnostic.path !== null || diagnostic.documentId !== null;
  }

  /**
   * Selects a severity filter.
   * @param value The chosen filter value.
   */
  protected selectSeverity(value: SeverityFilter): void {
    this.log.debug('workspace.problems', 'Filter by severity', value);
    this.severity.set(value);
  }

  /**
   * Selects a source filter.
   * @param value The chosen source, or {@link ALL_SOURCES}.
   */
  protected selectSource(value: string): void {
    this.log.debug('workspace.problems', 'Filter by source', value);
    this.source.set(value);
  }

  /**
   * Resolves the icon for a diagnostic's severity.
   * @param severity The diagnostic severity.
   * @returns Returns the severity icon.
   */
  public iconFor(severity: DiagnosticSeverity): Icon {
    return SEVERITY_ICONS[severity];
  }

  /**
   * Reveals a diagnostic in the editor: opens its file (so a build problem against a file that is not
   * yet open still opens it), then jumps the editor to the reported line and column when the document
   * is known. A diagnostic with neither a path nor an open document cannot be revealed.
   * @param diagnostic The diagnostic to reveal.
   */
  public reveal(diagnostic: Diagnostic): void {
    this.log.info(
      'workspace.problems',
      `Navigate to problem at ${diagnostic.file}:${diagnostic.line}`,
      diagnostic.message,
    );
    if (diagnostic.documentId === null && diagnostic.path !== null) {
      // A file that is not open (a whole-solution error, #1144): opened, then placed at the problem
      // once its editor has registered.
      void this.navigation.goTo(null, {
        path: diagnostic.path,
        range: {
          startLineNumber: diagnostic.line,
          startColumn: diagnostic.column,
          endLineNumber: diagnostic.line,
          endColumn: diagnostic.column,
        },
      });
      return;
    }
    if (diagnostic.path !== null) {
      void this.fileOpener.openPath(diagnostic.path);
    }
    if (diagnostic.documentId !== null) {
      this.editors.requestReveal(diagnostic.documentId, diagnostic.line, diagnostic.column);
    }
  }

  /**
   * Builds a stable tracking key for a diagnostic row.
   * @param index The row index.
   * @param diagnostic The diagnostic.
   * @returns Returns the tracking key.
   */
  public trackBy(index: number, diagnostic: Diagnostic): string {
    return `${diagnostic.file}:${diagnostic.line}:${diagnostic.column}:${diagnostic.message}`;
  }
}
