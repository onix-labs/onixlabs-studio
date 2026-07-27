import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  InputSignal,
  Signal,
  signal,
  WritableSignal,
} from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { TreeRow, TreeView } from '@shared/angular/components/tree-view/tree-view';
import { DebugState } from '@shared/angular/services/debug/debugger';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { Documents } from '@shared/angular/services/documents/documents';
import { Editors } from '@shared/angular/services/editors/editors';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import {
  DebugEvaluation,
  DebugFrame,
  DebugScope,
  DebugSession,
  DebugVariable,
} from '@features/workspace/angular/debug/debug-session';

/**
 * The payload a call-stack tree row carries.
 */
interface FrameRowData {
  /**
   * Gets the frame the row renders.
   */
  readonly frame: DebugFrame;
}

/**
 * The payload a variables tree row carries: either a scope header or a variable.
 */
type VariableRowData =
  | { readonly kind: 'scope'; readonly scope: DebugScope }
  | { readonly kind: 'variable'; readonly variable: DebugVariable };

/**
 * The body of the Debug dock panel: the call stack, the selected frame's variables (lazily expanded),
 * a watch list, and a transport toolbar that drives the workspace's {@link DebugSession}. It is shown
 * (by the directory view) only while a session is running, reads the session's inspection signals, and
 * routes execution-control clicks and a call-stack selection (revealing the frame's source) back to it.
 * The dock chrome renders the panel's title bar; this component owns only the body.
 */
@Component({
  selector: 'app-debug-panel',
  imports: [AppIcon, TextField, TreeView],
  templateUrl: './debug-panel.html',
  styleUrl: './debug-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DebugPanel {
  /**
   * Holds the workspace's debug session this panel drives and reads.
   */
  private readonly session: DebugSession = inject(DebugSession);

  /**
   * Holds the file opener used to bring a selected frame's source into the well.
   */
  private readonly fileOpener: FileOpener = inject(FileOpener);

  /**
   * Holds the document registry used to resolve an opened frame source to its document id.
   */
  private readonly documents: Documents = inject(Documents);

  /**
   * Holds the editor registry a reveal request is dispatched through.
   */
  private readonly editors: Editors = inject(Editors);

  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the dock panel descriptor this body renders. Set by the dock outlet; unused here because the
   * dock chrome renders the title.
   */
  public readonly panel: InputSignal<DockPanel> = input.required<DockPanel>();

  /**
   * Gets a value indicating whether the panel belongs to the active dock tab.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets the session's lifecycle state, driving which toolbar controls are enabled.
   */
  protected readonly state: Signal<DebugState> = this.session.state;

  /**
   * Gets whether the debuggee is paused (stopped at a breakpoint or step).
   */
  protected readonly paused: Signal<boolean> = computed((): boolean => this.state() === 'stopped');

  /**
   * Gets whether a session is running (executing or paused).
   */
  protected readonly active: Signal<boolean> = computed((): boolean => this.state() !== 'idle');

  /**
   * Gets the call-stack rows for the tree.
   */
  protected readonly callStackRows: Signal<readonly TreeRow[]> = computed((): readonly TreeRow[] =>
    this.session.callStack().map(
      (frame: DebugFrame): TreeRow => ({
        id: `frame:${frame.id}`,
        depth: 0,
        expandable: false,
        expanded: false,
        data: { frame } satisfies FrameRowData,
      }),
    ),
  );

  /**
   * Gets the id of the selected call-stack row.
   */
  protected readonly selectedFrameRow: Signal<string | null> = computed((): string | null => {
    const id: number | null = this.session.currentFrame();
    return id === null ? null : `frame:${id}`;
  });

  /**
   * Holds the fetched child variables, keyed by their variables reference, for lazy expansion.
   */
  private readonly variableChildren: WritableSignal<ReadonlyMap<number, readonly DebugVariable[]>> =
    signal<ReadonlyMap<number, readonly DebugVariable[]>>(
      new Map<number, readonly DebugVariable[]>(),
    );

  /**
   * Holds the ids of the expanded variable rows.
   */
  private readonly expandedRows: WritableSignal<ReadonlySet<string>> = signal<ReadonlySet<string>>(
    new Set<string>(),
  );

  /**
   * Gets the variables rows for the tree: the frame's scopes, with expanded scopes' and variables'
   * children spliced in beneath them.
   */
  protected readonly variableRows: Signal<readonly TreeRow[]> = computed((): readonly TreeRow[] => {
    const expanded: ReadonlySet<string> = this.expandedRows();
    const cache: ReadonlyMap<number, readonly DebugVariable[]> = this.variableChildren();
    const rows: TreeRow[] = [];
    const walk: (variables: readonly DebugVariable[], parentId: string, depth: number) => void = (
      variables: readonly DebugVariable[],
      parentId: string,
      depth: number,
    ): void => {
      variables.forEach((variable: DebugVariable, index: number): void => {
        const id: string = `${parentId}/${index}`;
        const canExpand: boolean = variable.variablesReference > 0;
        const open: boolean = expanded.has(id);
        rows.push({
          id,
          depth,
          expandable: canExpand,
          expanded: open,
          data: { kind: 'variable', variable } satisfies VariableRowData,
        });
        if (canExpand && open) {
          walk(cache.get(variable.variablesReference) ?? [], id, depth + 1);
        }
      });
    };
    this.session.scopes().forEach((scope: DebugScope, index: number): void => {
      const id: string = `scope:${index}`;
      const open: boolean = expanded.has(id);
      rows.push({
        id,
        depth: 0,
        expandable: scope.variablesReference > 0,
        expanded: open,
        data: { kind: 'scope', scope } satisfies VariableRowData,
      });
      if (open) {
        walk(cache.get(scope.variablesReference) ?? [], id, 1);
      }
    });
    return rows;
  });

  /**
   * Holds the watch expressions, in the order the user added them.
   */
  protected readonly watchExpressions: WritableSignal<readonly string[]> = signal<
    readonly string[]
  >([]);

  /**
   * Holds the latest evaluation of each watch expression, keyed by the expression.
   */
  protected readonly watchResults: WritableSignal<ReadonlyMap<string, DebugEvaluation>> = signal<
    ReadonlyMap<string, DebugEvaluation>
  >(new Map<string, DebugEvaluation>());

  /**
   * Holds the draft text of the new-watch input.
   */
  protected readonly newWatch: WritableSignal<string> = signal<string>('');

  /**
   * Wires the effects that reset the variable-tree state on each stop and re-evaluate the watch list
   * when the selected frame changes.
   */
  public constructor() {
    // A new stop replaces the scopes; drop the previous stop's fetched children and expansion so the
    // tree does not show stale values under a scope whose reference has been reused.
    effect((): void => {
      this.session.scopes();
      this.variableChildren.set(new Map<number, readonly DebugVariable[]>());
      this.expandedRows.set(new Set<string>());
    });

    // Re-evaluate every watch expression against the selected frame whenever it changes (a new stop or
    // a frame selection). Reads the expressions untracked so adding one does not re-run the whole list.
    effect((): void => {
      const frame: number | null = this.session.currentFrame();
      if (frame === null) {
        this.watchResults.set(new Map<string, DebugEvaluation>());
        return;
      }
      void this.evaluateAll();
    });
  }

  /**
   * Resumes the paused debuggee.
   */
  protected onContinue(): void {
    this.session.continue();
  }

  /**
   * Pauses the running debuggee.
   */
  protected onPause(): void {
    this.session.pause();
  }

  /**
   * Steps over the current line.
   */
  protected onStepOver(): void {
    this.session.stepOver();
  }

  /**
   * Steps into the call at the current line.
   */
  protected onStepInto(): void {
    this.session.stepIn();
  }

  /**
   * Steps out of the current function.
   */
  protected onStepOut(): void {
    this.session.stepOut();
  }

  /**
   * Stops the session.
   */
  protected onStop(): void {
    this.session.stop();
  }

  /**
   * Reads a call-stack row's frame.
   * @param row The tree row.
   * @returns Returns the frame.
   */
  protected frameOf(row: TreeRow): DebugFrame {
    return (row.data as FrameRowData).frame;
  }

  /**
   * Reads a variables row's payload.
   * @param row The tree row.
   * @returns Returns the row payload.
   */
  protected variableOf(row: TreeRow): VariableRowData {
    return row.data as VariableRowData;
  }

  /**
   * Selects a call-stack frame and reveals its source in the well.
   * @param row The clicked call-stack row.
   */
  protected onFrameClick(row: TreeRow): void {
    const frame: DebugFrame = this.frameOf(row);
    void this.session.selectFrame(frame.id);
    void this.reveal(frame);
  }

  /**
   * Toggles a variables row's expansion, fetching its children the first time it opens.
   * @param row The clicked variables row.
   */
  protected onVariableClick(row: TreeRow): void {
    if (!row.expandable) {
      return;
    }
    const data: VariableRowData = this.variableOf(row);
    const reference: number =
      data.kind === 'scope' ? data.scope.variablesReference : data.variable.variablesReference;
    const expanded: Set<string> = new Set<string>(this.expandedRows());
    if (expanded.has(row.id)) {
      expanded.delete(row.id);
      this.expandedRows.set(expanded);
      return;
    }
    expanded.add(row.id);
    this.expandedRows.set(expanded);
    if (!this.variableChildren().has(reference)) {
      void this.loadChildren(reference);
    }
  }

  /**
   * Adds the draft expression to the watch list and evaluates it.
   */
  protected addWatch(): void {
    const expression: string = this.newWatch().trim();
    if (expression.length === 0 || this.watchExpressions().includes(expression)) {
      this.newWatch.set('');
      return;
    }
    this.watchExpressions.set([...this.watchExpressions(), expression]);
    this.newWatch.set('');
    void this.evaluateOne(expression);
  }

  /**
   * Removes a watch expression and its result.
   * @param expression The expression to remove.
   */
  protected removeWatch(expression: string): void {
    this.watchExpressions.set(
      this.watchExpressions().filter((candidate: string): boolean => candidate !== expression),
    );
    const results: Map<string, DebugEvaluation> = new Map<string, DebugEvaluation>(
      this.watchResults(),
    );
    results.delete(expression);
    this.watchResults.set(results);
  }

  /**
   * Reads the latest evaluation of a watch expression, or undefined before it has been evaluated.
   * @param expression The expression.
   * @returns Returns the evaluation, or undefined.
   */
  protected watchResult(expression: string): DebugEvaluation | undefined {
    return this.watchResults().get(expression);
  }

  /**
   * Fetches a reference's child variables into the cache.
   * @param reference The variables reference to fetch.
   */
  private async loadChildren(reference: number): Promise<void> {
    const children: readonly DebugVariable[] = await this.session.variables(reference);
    const cache: Map<number, readonly DebugVariable[]> = new Map<number, readonly DebugVariable[]>(
      this.variableChildren(),
    );
    cache.set(reference, children);
    this.variableChildren.set(cache);
  }

  /**
   * Re-evaluates every watch expression against the selected frame.
   */
  private async evaluateAll(): Promise<void> {
    for (const expression of this.watchExpressions()) {
      await this.evaluateOne(expression);
    }
  }

  /**
   * Evaluates one watch expression and records its result.
   * @param expression The expression to evaluate.
   */
  private async evaluateOne(expression: string): Promise<void> {
    const evaluation: DebugEvaluation = await this.session.evaluate(expression);
    const results: Map<string, DebugEvaluation> = new Map<string, DebugEvaluation>(
      this.watchResults(),
    );
    results.set(expression, evaluation);
    this.watchResults.set(results);
  }

  /**
   * Opens a frame's source in the well and reveals its line.
   * @param frame The frame to reveal.
   */
  private async reveal(frame: DebugFrame): Promise<void> {
    if (frame.path === null) {
      return;
    }
    await this.fileOpener.openPath(frame.path);
    const documentId: string | undefined = this.documents.findIdByPath(frame.path);
    if (documentId !== undefined) {
      this.editors.requestReveal(documentId, frame.line, frame.column);
    }
  }
}
