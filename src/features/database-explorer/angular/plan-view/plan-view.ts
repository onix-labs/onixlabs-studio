import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  linkedSignal,
  output,
  OutputEmitterRef,
  Signal,
  signal,
  WritableSignal,
} from '@angular/core';
import { PlanProperty, QueryPlan } from '@shared/api/database-engine-protocol';
import { Table, TableColumn, TableRow, TableRowDef } from '@shared/angular/components/table/table';
import { TableTreeCell } from '@shared/angular/components/table/table-tree-cell/table-tree-cell';
import { TextEditor } from '@shared/angular/components/text-editor/text-editor';
import { Settings } from '@shared/angular/services/settings/settings';
import {
  DatabaseGridlines,
  DatabaseGridlineTone,
} from '@shared/angular/services/settings/settings-registry';
import {
  PlanFigures,
  planFigures,
  planProperties,
  PlanRow,
  planRows,
  rawPlanLanguage,
} from './plan-rows';

/**
 * How a plan is shown: as the expandable tree table, or as the engine's own text.
 */
export type PlanViewMode = 'tree' | 'raw';

/**
 * A plan step picked in the tree, for the Properties panel.
 */
export interface PlanPick {
  /**
   * Gets the step's operator, the panel's title.
   */
  readonly title: string;

  /**
   * Gets the step's facts.
   */
  readonly properties: readonly PlanProperty[];
}

/**
 * One statement the Plan view offers to show the plan of, when the text held several.
 */
export interface PlanStatement {
  /**
   * Gets the statement's index among the plans.
   */
  readonly index: number;

  /**
   * Gets its chip's label.
   */
  readonly label: string;
}

/**
 * The width of each figure column: room for a large count or a cost with its decimals, and for the
 * column's header.
 */
const FIGURE_WIDTH: string = '8.5rem';

/**
 * A query's plans, drawn the one way whichever engine described them (#1099): the statement chosen
 * (when the text held several), then its plan as an expandable tree table — the step indented under
 * the step it feeds, with the cost, estimated rows, actual rows and time the engine reported, a column
 * for each only when some step has it — or, in the Raw view, the engine's own plan text. A step whose
 * estimate was an order of magnitude out is marked in its Actual Rows cell. Picking a step reports
 * all its facts for the Properties panel.
 */
@Component({
  selector: 'app-plan-view',
  imports: [Table, TableRowDef, TableTreeCell, TextEditor],
  templateUrl: './plan-view.html',
  styleUrl: './plan-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlanView {
  private readonly settings: Settings = inject(Settings);

  /**
   * Gets the plans, one per statement.
   */
  public readonly plans: InputSignal<readonly QueryPlan[]> = input.required<readonly QueryPlan[]>();

  /**
   * Gets how the plan is shown.
   */
  public readonly view: InputSignal<PlanViewMode> = input<PlanViewMode>('tree');

  /**
   * Gets the document line the explained text starts on, so each statement is named by its line in
   * the document rather than in the text sent.
   */
  public readonly firstLine: InputSignal<number> = input<number>(1);

  /**
   * Emits the step picked in the tree.
   */
  public readonly picked: OutputEmitterRef<PlanPick> = output<PlanPick>();

  /**
   * Gets the font the tree is drawn in: Code's, as the results grid's is.
   */
  protected readonly gridFont: Signal<string> = this.settings.value('textEditor.global.fontFamily');

  /**
   * Gets which rules the tree draws between its cells, from the results grid's setting.
   */
  protected readonly gridlines: Signal<DatabaseGridlines> = this.settings.databaseGridlines;

  /**
   * Gets how strongly they are drawn.
   */
  protected readonly gridlineTone: Signal<DatabaseGridlineTone> =
    this.settings.databaseGridlineTone;

  /**
   * Holds which statement's plan is showing, back to the first whenever new plans arrive.
   */
  protected readonly index: WritableSignal<number> = linkedSignal<readonly QueryPlan[], number>({
    source: this.plans,
    computation: (): number => 0,
  });

  /**
   * Holds the step selected in the tree.
   */
  protected readonly selected: WritableSignal<ReadonlySet<string>> = signal<ReadonlySet<string>>(
    new Set<string>(),
  );

  /**
   * Gets the plan showing.
   */
  protected readonly plan: Signal<QueryPlan | undefined> = computed((): QueryPlan | undefined => {
    const plans: readonly QueryPlan[] = this.plans();
    return plans[Math.min(this.index(), plans.length - 1)];
  });

  /**
   * Gets the statements to choose between, when there are several.
   */
  protected readonly statements: Signal<readonly PlanStatement[]> = computed(
    (): readonly PlanStatement[] => {
      const plans: readonly QueryPlan[] = this.plans();
      if (plans.length < 2) {
        return [];
      }
      return plans.map((plan: QueryPlan, index: number): PlanStatement => {
        const number: number = index + 1;
        const line: number = this.firstLine() + plan.line - 1;
        return {
          index,
          label: $localize`:A chip choosing one statement's plan. The first figure counts statements, the second is a line number:Statement ${number}:number: · Line ${line}:line:`,
        };
      });
    },
  );

  /**
   * Gets the showing plan's steps, in tree order.
   */
  private readonly steps: Signal<readonly PlanRow[]> = computed((): readonly PlanRow[] => {
    const plan: QueryPlan | undefined = this.plan();
    return plan === undefined ? [] : planRows(plan, this.index());
  });

  /**
   * Gets which figure columns the plan fills.
   */
  protected readonly figures: Signal<PlanFigures> = computed((): PlanFigures =>
    planFigures(this.steps()),
  );

  /**
   * Gets the tree table's columns: the step, then each figure the engine reported.
   */
  protected readonly columns: Signal<readonly TableColumn[]> = computed(
    (): readonly TableColumn[] => {
      const figures: PlanFigures = this.figures();
      const column: (id: string, header: string, tooltip: string) => TableColumn = (
        id: string,
        header: string,
        tooltip: string,
      ): TableColumn => ({ id, header, headerTooltip: tooltip, width: FIGURE_WIDTH, align: 'end' });
      return [
        {
          id: 'step',
          header: $localize`:The plan tree's first column, the steps the database takes:Step`,
        },
        ...(figures.cost
          ? [
              column(
                'cost',
                $localize`:A plan column header:Cost`,
                $localize`:Tooltip on the plan's Cost column:The planner's estimated cost of the step and the steps feeding it, in the database's own units`,
              ),
            ]
          : []),
        ...(figures.estimatedRows
          ? [
              column(
                'estimated',
                $localize`:A plan column header, short for estimated rows:Est. Rows`,
                $localize`:Tooltip on the plan's estimated rows column:The rows the planner expected the step to produce`,
              ),
            ]
          : []),
        ...(figures.actualRows
          ? [
              column(
                'actual',
                $localize`:A plan column header:Actual Rows`,
                $localize`:Tooltip on the plan's actual rows column:The rows the step produced when the query ran`,
              ),
            ]
          : []),
        ...(figures.time
          ? [
              column(
                'time',
                $localize`:A plan column header, a time in milliseconds:Time (ms)`,
                $localize`:Tooltip on the plan's time column:How long the step took when the query ran, in milliseconds`,
              ),
            ]
          : []),
      ];
    },
  );

  /**
   * Gets the tree table's rows.
   */
  protected readonly rows: Signal<readonly TableRow[]> = computed((): readonly TableRow[] =>
    this.steps().map((step: PlanRow): TableRow => ({ id: step.id, depth: step.depth, data: step })),
  );

  /**
   * Gets the Raw view's language: JSON, XML or plain text, by what the engine sent.
   */
  protected readonly rawLanguage: Signal<string> = computed((): string =>
    rawPlanLanguage(this.plan()?.raw ?? ''),
  );

  /**
   * Shows another statement's plan.
   * @param index The statement's index.
   */
  protected choose(index: number): void {
    this.index.set(index);
    this.selected.set(new Set<string>());
  }

  /**
   * Selects a step and reports its facts.
   * @param row The step's row.
   */
  protected onRowClick(row: TableRow): void {
    const step: PlanRow | undefined = this.steps().find(
      (each: PlanRow): boolean => each.id === row.id,
    );
    if (step === undefined) {
      return;
    }
    this.selected.set(new Set<string>([row.id]));
    this.picked.emit({ title: step.operator, properties: planProperties(step.node) });
  }
}
