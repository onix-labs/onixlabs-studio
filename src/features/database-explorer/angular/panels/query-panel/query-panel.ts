import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  InputSignal,
  Signal,
  signal,
  untracked,
  viewChild,
  WritableSignal,
} from '@angular/core';
import type * as MonacoApi from 'monaco-editor';
import {
  DatabaseEngineInfo,
  DatabaseNode,
  DatabaseValue,
  ExecuteOutcome,
  QueryMessage,
  ResultSet,
} from '@shared/api/database-engine-protocol';
import { DatabaseConnection, DatabaseQuery } from '@shared/api/database-document';
import { Button } from '@shared/angular/components/forms/button/button';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Panel } from '@shared/angular/components/panel-layout/panel';
import { PanelLayout } from '@shared/angular/components/panel-layout/panel-layout';
import { PanelEdge } from '@shared/angular/components/panel-layout/panel-types';
import { PanelToolbar } from '@shared/angular/components/panel-toolbar/panel-toolbar';
import { Table, TableColumn, TableRow, TableRowDef } from '@shared/angular/components/table/table';
import { TextEditor, TextEditorCursor } from '@shared/angular/components/text-editor/text-editor';
import {
  DocumentStatus,
  DocumentStatusInfo,
  StatusChip,
} from '@shared/angular/services/document-status/document-status';
import { Settings } from '@shared/angular/services/settings/settings';
import {
  DatabaseGridlines,
  DatabaseGridlineTone,
} from '@shared/angular/services/settings/settings-registry';
import { Icon } from '@shared/angular/icons/icon';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import { findStackOfPanel } from '@shared/angular/services/dock-layout/dock-tree';
import { Monaco } from '@shared/angular/services/monaco/monaco';
import { markStudioProvider } from '@shared/angular/services/monaco/monaco-editor-capabilities';
import { CompletionNameKind } from '@shared/api/database-engine-protocol';
import {
  DatabaseCompletions,
  QueryCompletion,
} from '../../database-completions/database-completions';
import { CellText, cellText, holdsGraph, plainValue } from '../../database-values';
import { DatabaseQueryOpener } from '../../database-query-opener/database-query-opener';
import {
  DatabaseWorkspace,
  NodeChildren,
  nodeKey,
} from '../../database-workspace/database-workspace';
import { GraphPick, GraphView } from '../../graph-view/graph-view';

/**
 * The edges the results pane may sit on: beneath the editor only.
 */
const RESULTS_EDGES: readonly PanelEdge[] = ['bottom'];

/**
 * The share of the panel the results pane opens at.
 */
const RESULTS_SHARE: number = 0.45;

/**
 * The marker owner the query's error squiggles are filed under.
 */
const MARKER_OWNER: string = 'database-explorer';

/**
 * The display names of the languages a query is written in, for the status strip.
 */
const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  sql: 'SQL',
  pgsql: 'PostgreSQL',
  mysql: 'MySQL',
  cypher: 'Cypher',
};

/**
 * Formats how long a query took: milliseconds under a second, seconds above.
 * @param ms The elapsed time in milliseconds.
 * @returns Returns the text.
 */
function formatElapsed(ms: number): string {
  return ms < 1000 ? `${Math.max(1, Math.round(ms))} ms` : `${(ms / 1000).toFixed(2)} s`;
}

/**
 * How a result is shown.
 */
type ResultView = 'table' | 'graph' | 'raw';

/**
 * One grid row, its cells already formatted.
 */
interface GridRow {
  readonly index: number;
  readonly cells: readonly CellText[];
}

/**
 * One query open in the Database Explorer's well: the editor over its Results and Messages, the way a
 * query window is in SSMS. Its tool strip names the connection (and, for an engine that reaches several,
 * the database) it runs against, and Execute.
 *
 * Execute runs the selection when there is one and the whole document otherwise — SSMS's F5 rule — and
 * ⌘↵ does the same from the keyboard. An error is marked in the editor at the line the engine reported,
 * and clicking a message's line number jumps there.
 */
@Component({
  selector: 'app-query-panel',
  imports: [
    AppIcon,
    Button,
    Dropdown,
    GraphView,
    Panel,
    PanelLayout,
    PanelToolbar,
    Table,
    TableRowDef,
    TextEditor,
  ],
  templateUrl: './query-panel.html',
  styleUrl: './query-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QueryPanel {
  /**
   * Gets the dock panel this component is projected into; its id is the query's id.
   */
  public readonly panel: InputSignal<DockPanel> = input.required<DockPanel>();

  private readonly workspace: DatabaseWorkspace = inject(DatabaseWorkspace);
  private readonly opener: DatabaseQueryOpener = inject(DatabaseQueryOpener);
  private readonly dockState: DockState = inject(DockState);
  private readonly monaco: Monaco = inject(Monaco);
  private readonly documentStatus: DocumentStatus = inject(DocumentStatus);
  private readonly settings: Settings = inject(Settings);

  /**
   * Gets which rules the results grid draws between its cells, from the user's setting.
   */
  protected readonly gridlines: Signal<DatabaseGridlines> = this.settings.databaseGridlines;

  /**
   * Gets how strongly the results grid draws its gridlines, from the user's setting.
   */
  protected readonly gridlineTone: Signal<DatabaseGridlineTone> =
    this.settings.databaseGridlineTone;

  /**
   * Holds the editor's caret, for the well's status strip.
   */
  private readonly cursor: WritableSignal<TextEditorCursor | null> =
    signal<TextEditorCursor | null>(null);
  private readonly elementRef: ElementRef<HTMLElement> =
    inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly Icon: typeof Icon = Icon;
  protected readonly resultsEdges: readonly PanelEdge[] = RESULTS_EDGES;

  /**
   * Holds the editor, once it has rendered.
   */
  private readonly editor: Signal<TextEditor | undefined> = viewChild<TextEditor>(TextEditor);

  /**
   * Holds the panel's height, for the results pane's default share of it.
   */
  private readonly hostHeight: WritableSignal<number | null> = signal<number | null>(null);

  /**
   * Holds which tab of the results pane is showing.
   */
  protected readonly tab: WritableSignal<'results' | 'messages'> = signal<'results' | 'messages'>(
    'results',
  );

  /**
   * Holds which result set is showing, by index.
   */
  protected readonly resultIndex: WritableSignal<number> = signal<number>(0);

  /**
   * Holds how the result is shown; null until chosen, when a graph result opens as a graph.
   */
  private readonly chosenView: WritableSignal<ResultView | null> = signal<ResultView | null>(null);

  /**
   * Holds the selected grid row.
   */
  protected readonly selectedRows: WritableSignal<ReadonlySet<string>> = signal<
    ReadonlySet<string>
  >(new Set<string>());

  /**
   * Gets the query, or undefined once it has been deleted from under the tab.
   */
  protected readonly query: Signal<DatabaseQuery | undefined> = computed(
    (): DatabaseQuery | undefined =>
      this.workspace
        .queries()
        .find((query: DatabaseQuery): boolean => query.id === this.panel().id),
  );

  /**
   * Gets the connection the query runs against.
   */
  private readonly connection: Signal<DatabaseConnection | undefined> = computed(
    (): DatabaseConnection | undefined =>
      this.workspace.connection(this.query()?.connectionId ?? null),
  );

  /**
   * Gets the engine of that connection.
   */
  private readonly engine: Signal<DatabaseEngineInfo | undefined> = computed(
    (): DatabaseEngineInfo | undefined => {
      const connection: DatabaseConnection | undefined = this.connection();
      return connection === undefined ? undefined : this.workspace.engine(connection.engine);
    },
  );

  /**
   * Gets the language the editor highlights.
   */
  protected readonly language: Signal<string> = computed(
    (): string => this.engine()?.language ?? 'sql',
  );

  /**
   * Gets whether this query is the active document in its well, so its editor lays out and focuses.
   */
  protected readonly isActive: Signal<boolean> = computed((): boolean => {
    const id: string = this.panel().id;
    return findStackOfPanel(this.dockState.layout(), id)?.active === id;
  });

  /**
   * Gets the connections offered by the connection picker.
   */
  protected readonly connectionOptions: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] =>
      this.workspace.connections().map((connection: DatabaseConnection): DropdownOption => ({
        value: connection.id,
        label: connection.name,
      })),
  );

  /**
   * Gets the databases offered by the database picker: those the connection's tree lists, for an
   * engine that reaches several. Empty — and the picker hidden — otherwise.
   */
  protected readonly databaseOptions: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] => {
      const connection: DatabaseConnection | undefined = this.connection();
      if (
        connection === undefined ||
        this.engine()?.capabilities.includes('multipleDatabases') !== true
      ) {
        return [];
      }
      const top: NodeChildren | undefined = this.workspace
        .children()
        .get(nodeKey(connection.id, null));
      const nodes: readonly DatabaseNode[] = top?.state === 'loaded' ? top.nodes : [];
      const names: string[] = nodes
        .map((node: DatabaseNode): string | undefined => node.database)
        .filter((name: string | undefined): name is string => name !== undefined);
      const current: string | undefined = this.query()?.database;
      if (current !== undefined && !names.includes(current)) {
        names.unshift(current);
      }
      return [
        { value: '', label: 'Default database' },
        ...names.map((name: string): DropdownOption => ({ value: name, label: name })),
      ];
    },
  );

  /**
   * Gets whether the query is running.
   */
  protected readonly running: Signal<boolean> = computed((): boolean =>
    this.workspace.running().has(this.panel().id),
  );

  /**
   * Gets whether the query can run (or, while running, be cancelled).
   */
  protected readonly canRun: Signal<boolean> = computed((): boolean => {
    if (this.running()) {
      return this.engine()?.capabilities.includes('cancel') === true;
    }
    return this.connection() !== undefined;
  });

  /**
   * Gets the query's latest outcome.
   */
  protected readonly outcome: Signal<ExecuteOutcome | null> = computed(
    (): ExecuteOutcome | null => {
      this.workspace.running();
      return this.workspace.outcomes().get(this.panel().id) ?? null;
    },
  );

  /**
   * Gets whether the results pane is showing: once the query has run, or while it is running.
   */
  protected readonly resultsVisible: Signal<boolean> = computed(
    (): boolean => this.running() || this.outcome() !== null,
  );

  /**
   * Gets the result set showing.
   */
  protected readonly resultSet: Signal<ResultSet | undefined> = computed(
    (): ResultSet | undefined => {
      const sets: readonly ResultSet[] = this.outcome()?.resultSets ?? [];
      return sets[Math.min(this.resultIndex(), sets.length - 1)];
    },
  );

  /**
   * Gets whether the result set holds graph values, so the Graph view is offered.
   */
  protected readonly graphCapable: Signal<boolean> = computed((): boolean =>
    (this.resultSet()?.rows ?? []).some((row: readonly DatabaseValue[]): boolean =>
      row.some(holdsGraph),
    ),
  );

  /**
   * Gets how the result is shown: as chosen, or as a graph when it holds one.
   */
  protected readonly resultView: Signal<ResultView> = computed((): ResultView => {
    const chosen: ResultView | null = this.chosenView();
    if (chosen === 'graph' && !this.graphCapable()) {
      return 'table';
    }
    return chosen ?? (this.graphCapable() ? 'graph' : 'table');
  });

  /**
   * Gets the grid's columns: a row number, then the result's own.
   */
  protected readonly columns: Signal<readonly TableColumn[]> = computed(
    (): readonly TableColumn[] => [
      { id: '#', header: '', width: '3.25rem', align: 'end' },
      ...(this.resultSet()?.columns ?? []).map((column, index: number): TableColumn => ({
        id: `${index}`,
        header: column.name,
        width: '11rem',
        align: this.numericColumns().has(index) ? 'end' : 'start',
        headerTooltip: column.type === undefined ? column.name : `${column.name} — ${column.type}`,
      })),
    ],
  );

  /**
   * Gets the indexes of the columns whose first value is a number, so they align to the right as
   * figures do.
   */
  private readonly numericColumns: Signal<ReadonlySet<number>> = computed(
    (): ReadonlySet<number> => {
      const set: ResultSet | undefined = this.resultSet();
      const numeric: Set<number> = new Set<number>();
      set?.columns.forEach((_column, index: number): void => {
        const first: DatabaseValue | undefined = set.rows
          .map((row: readonly DatabaseValue[]): DatabaseValue => row[index] ?? null)
          .find((value: DatabaseValue): boolean => value !== null);
        if (first !== undefined && cellText(first).kind === 'number') {
          numeric.add(index);
        }
      });
      return numeric;
    },
  );

  /**
   * Gets the grid's rows, formatted once per result rather than once per change detection.
   */
  protected readonly gridRows: Signal<readonly TableRow[]> = computed((): readonly TableRow[] =>
    (this.resultSet()?.rows ?? []).map(
      (row: readonly DatabaseValue[], index: number): TableRow => ({
        id: `${index}`,
        data: { index: index + 1, cells: row.map(cellText) } satisfies GridRow,
      }),
    ),
  );

  /**
   * Gets the result as JSON, for the Raw view.
   */
  protected readonly rawJson: Signal<string> = computed((): string => {
    const set: ResultSet | undefined = this.resultSet();
    if (set === undefined) {
      return '';
    }
    const names: readonly string[] = set.columns.map((column): string => column.name);
    return JSON.stringify(
      set.rows.map((row: readonly DatabaseValue[]) =>
        Object.fromEntries(
          row.map((value: DatabaseValue, index: number): [string, unknown] => [
            names[index] ?? `${index}`,
            plainValue(value),
          ]),
        ),
      ),
      null,
      2,
    );
  });

  /**
   * Gets how many error messages the outcome holds, for the Messages tab's badge.
   */
  protected readonly errorCount: Signal<number> = computed(
    (): number =>
      (this.outcome()?.messages ?? []).filter(
        (message: QueryMessage): boolean => message.severity === 'error',
      ).length,
  );

  /**
   * Gets the results pane's default height: a share of the panel.
   */
  protected readonly resultsDefaultSize: Signal<number | null> = computed((): number | null => {
    const height: number | null = this.hostHeight();
    return height === null ? null : Math.max(140, Math.round(height * RESULTS_SHARE));
  });

  /**
   * Holds the editor's ⌘↵ command, so it is added once.
   */
  private commandAdded: boolean = false;

  /**
   * Holds the completions the editor is offered from the connection's engine (#1098).
   */
  private readonly completions: DatabaseCompletions = inject(DatabaseCompletions);

  /**
   * Holds the editor's completion providers, one per query language, disposed with the panel.
   */
  private completionProviders: readonly MonacoApi.IDisposable[] = [];

  /**
   * Wires the panel's height observer, and keeps the editor's error squiggles in step with the outcome.
   */
  public constructor() {
    const destroyRef: DestroyRef = inject(DestroyRef);
    // The well's status strip (#882), while this query is the active document: how its last run went,
    // what the result showing holds, where the caret is, and the language.
    effect((): void => {
      const id: string = this.panel().id;
      if (!this.isActive() || this.query() === undefined) {
        untracked((): void => this.documentStatus.clear(id));
        return;
      }
      const info: DocumentStatusInfo = this.statusInfo();
      untracked((): void => this.documentStatus.set(id, info));
    });
    destroyRef.onDestroy((): void => this.documentStatus.clear(this.panel().id));
    destroyRef.onDestroy((): void => {
      for (const provider of this.completionProviders) {
        provider.dispose();
      }
    });

    // The ribbon's Execute runs this panel exactly as its own button does, selection and all.
    effect((onCleanup: (cleanup: () => void) => void): void => {
      const detach: () => void = this.opener.attach(this.panel().id, (): void => this.execute());
      onCleanup(detach);
    });
    if (typeof ResizeObserver !== 'undefined') {
      const host: HTMLElement = this.elementRef.nativeElement;
      const observer: ResizeObserver = new ResizeObserver((): void => {
        this.hostHeight.set(host.clientHeight > 0 ? host.clientHeight : null);
      });
      observer.observe(host);
      destroyRef.onDestroy((): void => observer.disconnect());
    }

    // A new outcome: show its first result, open on Messages when it failed with nothing to show, and
    // mark its errors in the editor.
    // Keyed on the execution's id, so fetching more rows into the same outcome changes nothing here.
    const executionId: Signal<string | null> = computed(
      (): string | null => this.outcome()?.id ?? null,
    );
    effect((): void => {
      executionId();
      untracked((): void => {
        const outcome: ExecuteOutcome | null = this.outcome();
        this.resultIndex.set(0);
        this.chosenView.set(null);
        this.selectedRows.set(new Set<string>());
        if (outcome !== null) {
          this.tab.set(outcome.resultSets.length === 0 ? 'messages' : 'results');
        }
        this.markErrors(outcome);
      });
    });
  }

  /**
   * Records where the editor's caret is.
   * @param cursor The caret.
   */
  protected onCursor(cursor: TextEditorCursor): void {
    this.cursor.set(cursor);
  }

  /**
   * Builds what the well's status strip shows for this query.
   * @returns Returns the status.
   */
  private statusInfo(): DocumentStatusInfo {
    const outcome: ExecuteOutcome | null = this.outcome();
    const set: ResultSet | undefined = this.resultSet();
    const sets: number = outcome?.resultSets.length ?? 0;
    const cursor: TextEditorCursor | null = this.cursor();
    const details: { readonly text: string; readonly title: string }[] = [];
    if (!this.running() && outcome !== null) {
      if (set !== undefined) {
        if (sets > 1) {
          details.push({
            text: `Result ${this.resultIndex() + 1} of ${sets}`,
            title: 'The result set showing',
          });
        }
        details.push({
          text:
            set.rows.length < set.totalRows
              ? `${set.rows.length.toLocaleString()} of ${set.totalRows.toLocaleString()} rows`
              : `${set.totalRows.toLocaleString()} ${set.totalRows === 1 ? 'row' : 'rows'}`,
          title: 'Rows the result set returned, and how many are loaded',
        });
        details.push({
          text: `${set.columns.length} ${set.columns.length === 1 ? 'column' : 'columns'}`,
          title: 'Columns in the result set',
        });
      }
      details.push({ text: formatElapsed(outcome.elapsedMs), title: 'How long the query took' });
    }
    return {
      chip: this.statusChip(outcome),
      details,
      ...(cursor === null ? {} : { line: cursor.line, column: cursor.column }),
      language: LANGUAGE_NAMES[this.language()] ?? this.language(),
    };
  }

  /**
   * Gets the chip summing up the query's state.
   * @param outcome The latest outcome.
   * @returns Returns the chip, or undefined before the query has run.
   */
  private statusChip(outcome: ExecuteOutcome | null): StatusChip | undefined {
    if (this.running()) {
      return { text: 'Running', tone: 'info', title: 'The query is running' };
    }
    if (outcome === null) {
      return undefined;
    }
    if (outcome.cancelled) {
      return { text: 'Cancelled', tone: 'warning', title: 'The last run was cancelled' };
    }
    return outcome.failed
      ? { text: 'Failed', tone: 'danger', title: 'The last run stopped on an error; see Messages' }
      : { text: 'Completed', tone: 'success', title: 'The last run completed' };
  }

  /**
   * Adds ⌘↵ to the editor once it is ready.
   */
  protected onEditorReady(): void {
    const editor: MonacoApi.editor.IStandaloneCodeEditor | null =
      this.editor()?.getEditor() ?? null;
    const monaco: typeof MonacoApi | undefined = this.monaco.getMonaco();
    if (editor === null || monaco === undefined || this.commandAdded) {
      return;
    }
    this.commandAdded = true;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, (): void => this.execute());
    this.completionProviders = QUERY_LANGUAGES.map((language: string): MonacoApi.IDisposable =>
      monaco.languages.registerCompletionItemProvider(language, this.completionProvider(monaco)),
    );
    this.markErrors(this.outcome());
  }

  /**
   * Builds the provider that completes this panel's query from its connection's engine. It answers for
   * this editor's model only — every query panel registers one — and is marked as Studio's, so its
   * names replace the words Monaco would otherwise guess from the text.
   * @param monaco The Monaco API.
   * @returns Returns the provider.
   */
  private completionProvider(monaco: typeof MonacoApi): MonacoApi.languages.CompletionItemProvider {
    const provider: MonacoApi.languages.CompletionItemProvider = {
      triggerCharacters: ['.', ':'],
      provideCompletionItems: async (
        model: MonacoApi.editor.ITextModel,
        position: MonacoApi.Position,
      ): Promise<MonacoApi.languages.CompletionList | undefined> => {
        // Read the editor afresh: the text editor can rebuild its Monaco editor, so one held from
        // when the provider was made can be a model behind.
        if (model !== this.editor()?.getEditor()?.getModel()) {
          return undefined;
        }
        const items: readonly QueryCompletion[] = await this.completions.complete(
          this.panel().id,
          model.getValue(),
          model.getOffsetAt(position),
        );
        if (items.length === 0) {
          return undefined;
        }
        const word: MonacoApi.editor.IWordAtPosition = model.getWordUntilPosition(position);
        const range: MonacoApi.IRange = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };
        return {
          suggestions: items.map(
            (item: QueryCompletion, index: number): MonacoApi.languages.CompletionItem => ({
              label: {
                label: item.label,
                ...(item.detail === undefined ? {} : { description: item.detail }),
              },
              kind: completionKind(monaco, item.kind),
              insertText: item.insertText,
              filterText: item.label,
              // Kept in the engine's order — a referenced table's columns before everything else.
              sortText: String(index).padStart(6, '0'),
              range,
            }),
          ),
        };
      },
    };
    markStudioProvider(provider);
    return provider;
  }

  /**
   * Runs the selection, or the whole query when nothing is selected; cancels it when it is running.
   */
  public execute(): void {
    const id: string = this.panel().id;
    if (this.running()) {
      this.workspace.cancel(id);
      return;
    }
    const editor: MonacoApi.editor.IStandaloneCodeEditor | null =
      this.editor()?.getEditor() ?? null;
    const model: MonacoApi.editor.ITextModel | null = editor?.getModel() ?? null;
    const selection: MonacoApi.Selection | null = editor?.getSelection() ?? null;
    if (model !== null && selection !== null && !selection.isEmpty()) {
      void this.workspace.execute(id, model.getValueInRange(selection), selection.startLineNumber);
      return;
    }
    void this.workspace.execute(id, this.query()?.text ?? '', 1);
  }

  /**
   * Records an edit to the query's text.
   * @param text The editor's text.
   */
  protected onText(text: string): void {
    this.workspace.updateQuery(this.panel().id, { text });
  }

  /**
   * Points the query at another connection, dropping a database the new one may not have.
   * @param id The connection's id.
   */
  protected setConnection(id: string): void {
    this.workspace.updateQuery(this.panel().id, {
      connectionId: id === '' ? null : id,
      database: undefined,
    });
    if (id !== '' && this.workspace.sessions().has(id) === false) {
      void this.workspace.connect(id);
    }
  }

  /**
   * Points the query at another database.
   * @param name The database, or empty for the connection's default.
   */
  protected setDatabase(name: string): void {
    this.workspace.updateQuery(this.panel().id, { database: name === '' ? undefined : name });
  }

  /**
   * Shows the result another way.
   * @param view The view.
   */
  protected chooseView(view: ResultView): void {
    this.chosenView.set(view);
  }

  /**
   * Shows another result set.
   * @param index Its index.
   */
  protected chooseResult(index: number): void {
    this.resultIndex.set(index);
    this.chosenView.set(null);
    this.selectedRows.set(new Set<string>());
  }

  /**
   * Selects a grid row, and shows it in Properties.
   * @param row The clicked row.
   */
  protected onRowClick(row: TableRow): void {
    this.selectedRows.set(new Set<string>([row.id]));
    const set: ResultSet | undefined = this.resultSet();
    const cells: readonly DatabaseValue[] | undefined = set?.rows[Number(row.id)];
    if (set === undefined || cells === undefined) {
      return;
    }
    this.workspace.select({
      kind: 'graph',
      title: `Row ${Number(row.id) + 1}`,
      properties: set.columns.map((column, index: number) => ({
        name: column.name,
        value: cellText(cells[index] ?? null).text,
      })),
    });
  }

  /**
   * Shows a graph pick in Properties.
   * @param pick What was picked.
   */
  protected onGraphPick(pick: GraphPick): void {
    this.workspace.select({ kind: 'graph', title: pick.title, properties: pick.properties });
  }

  /**
   * Fetches the next page of the showing result set.
   */
  protected loadMore(): void {
    const set: ResultSet | undefined = this.resultSet();
    if (set !== undefined) {
      void this.workspace.fetchMore(this.panel().id, set.id);
    }
  }

  /**
   * Moves the editor's caret to a message's line.
   * @param message The message.
   */
  protected reveal(message: QueryMessage): void {
    if (message.line !== undefined) {
      this.editor()?.reveal(message.line, 1);
      this.editor()?.focus();
    }
  }

  /**
   * Gets a message's icon.
   * @param message The message.
   * @returns Returns the icon.
   */
  protected messageIcon(message: QueryMessage): Icon {
    return message.severity === 'error'
      ? Icon.ERROR
      : message.severity === 'warning'
        ? Icon.WARNING
        : Icon.INFO;
  }

  /**
   * Gets a result set's chip label.
   * @param set The result set.
   * @param index Its index.
   * @returns Returns the label.
   */
  protected resultLabel(set: ResultSet, index: number): string {
    return `Result ${index + 1} · ${set.totalRows.toLocaleString()} row${set.totalRows === 1 ? '' : 's'}`;
  }

  /**
   * Marks the outcome's errors in the editor as squiggles on their lines.
   * @param outcome The outcome, or null to clear them.
   */
  private markErrors(outcome: ExecuteOutcome | null): void {
    const model: MonacoApi.editor.ITextModel | null = this.editor()?.getModel() ?? null;
    const monaco: typeof MonacoApi | undefined = this.monaco.getMonaco();
    if (model === null || monaco === undefined) {
      return;
    }
    const markers: MonacoApi.editor.IMarkerData[] = (outcome?.messages ?? [])
      .filter(
        (message: QueryMessage): boolean =>
          message.severity === 'error' && message.line !== undefined,
      )
      .map((message: QueryMessage): MonacoApi.editor.IMarkerData => {
        const line: number = Math.min(Math.max(1, message.line ?? 1), model.getLineCount());
        return {
          severity: monaco.MarkerSeverity.Error,
          message: message.text,
          startLineNumber: line,
          startColumn: model.getLineFirstNonWhitespaceColumn(line) || 1,
          endLineNumber: line,
          endColumn: model.getLineMaxColumn(line),
        };
      });
    monaco.editor.setModelMarkers(model, MARKER_OWNER, markers);
  }
}

/**
 * The languages a query is written in, each of which the panel completes.
 */
const QUERY_LANGUAGES: readonly string[] = ['sql', 'pgsql', 'cypher'];

/**
 * Maps a completion name's kind to the editor's, which decides the icon Studio's list draws.
 * @param monaco The Monaco API.
 * @param kind The name's kind.
 * @returns Returns the editor's kind.
 */
function completionKind(
  monaco: typeof MonacoApi,
  kind: CompletionNameKind,
): MonacoApi.languages.CompletionItemKind {
  const kinds: typeof MonacoApi.languages.CompletionItemKind = monaco.languages.CompletionItemKind;
  switch (kind) {
    case 'schema':
      return kinds.Module;
    case 'table':
      return kinds.Struct;
    case 'view':
      return kinds.Interface;
    case 'function':
      return kinds.Function;
    case 'column':
      return kinds.Field;
    case 'label':
      return kinds.Class;
    case 'relationship':
      return kinds.Event;
    case 'property':
      return kinds.Property;
  }
}
