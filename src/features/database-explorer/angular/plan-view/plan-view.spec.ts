import { beforeEach, describe, expect, it } from 'vitest';
import { Component, input, InputSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { QueryPlan } from '@shared/api/database-engine-protocol';
import { TextEditor } from '@shared/angular/components/text-editor/text-editor';
import { PlanPick, PlanView } from './plan-view';

/**
 * Stands in for the code editor the Raw view draws, so the spec need not load Monaco.
 */
@Component({
  selector: 'app-text-editor',
  template: '<pre data-testid="raw-text" [attr.data-language]="language()">{{ content() }}</pre>',
})
class FakeTextEditor {
  public readonly content: InputSignal<string> = input<string>('');
  public readonly language: InputSignal<string> = input<string>('');
  public readonly readOnly: InputSignal<boolean> = input<boolean>(false);
}

/**
 * A PostgreSQL-shaped plan: a join over a scan whose estimate was far out, and a hash over an index
 * scan.
 */
const JOIN: QueryPlan = {
  statement: 'select * from books join authors on authors.id = books.author_id',
  line: 1,
  root: {
    operator: 'Hash Join',
    detail: 'Inner',
    cost: 120.5,
    estimatedRows: 100,
    actualRows: 90,
    time: 2.5,
    children: [
      {
        operator: 'Seq Scan',
        detail: 'on books',
        cost: 80,
        estimatedRows: 10,
        actualRows: 900,
        time: 1,
        children: [],
      },
      {
        operator: 'Hash',
        cost: 30,
        estimatedRows: 20,
        actualRows: 20,
        children: [
          {
            operator: 'Index Scan',
            detail: 'on authors',
            cost: 20,
            estimatedRows: 20,
            actualRows: 20,
            children: [],
          },
        ],
      },
    ],
  },
  raw: '[{"Plan":{"Node Type":"Hash Join"}}]',
};

/**
 * A SQLite-shaped plan of a second statement: steps without a figure.
 */
const SCAN: QueryPlan = {
  statement: 'select * from t',
  line: 3,
  root: { operator: 'QUERY PLAN', children: [{ operator: 'SCAN', detail: 't', children: [] }] },
  raw: '[{"id":2,"parent":0,"detail":"SCAN t"}]',
};

describe('PlanView', () => {
  let fixture: ComponentFixture<PlanView>;
  let picks: PlanPick[];

  /**
   * Gets the rendered element.
   * @returns Returns it.
   */
  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  /**
   * Reads the header cells of the tree table.
   * @returns Returns their text.
   */
  function headers(): readonly string[] {
    return Array.from(host().querySelectorAll<HTMLElement>('th'))
      .map((cell: HTMLElement): string => cell.textContent?.trim() ?? '')
      .filter((text: string): boolean => text !== '');
  }

  /**
   * Reads the rendered rows, each as its cells' text.
   * @returns Returns the rows.
   */
  function rows(): readonly (readonly string[])[] {
    return Array.from(host().querySelectorAll<HTMLElement>('.table-row')).map(
      (row: HTMLElement): readonly string[] =>
        Array.from(row.querySelectorAll<HTMLElement>('td:not(.table-filler)')).map(
          (cell: HTMLElement): string => {
            // The step's operator and detail are spaced apart by the stylesheet, not by text.
            const parts: readonly HTMLElement[] = Array.from(
              cell.querySelectorAll<HTMLElement>('.plan__operator, .plan__detail'),
            );
            return parts.length > 0
              ? parts.map((part: HTMLElement): string => part.textContent?.trim() ?? '').join(' ')
              : (cell.textContent?.trim() ?? '');
          },
        ),
    );
  }

  /**
   * Shows plans.
   * @param plans The plans.
   * @param view How to show them.
   */
  async function show(plans: readonly QueryPlan[], view: 'tree' | 'raw' = 'tree'): Promise<void> {
    fixture.componentRef.setInput('plans', plans);
    fixture.componentRef.setInput('view', view);
    await fixture.whenStable();
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [PlanView] });
    TestBed.overrideComponent(PlanView, {
      remove: { imports: [TextEditor] },
      add: { imports: [FakeTextEditor] },
    });
    await TestBed.compileComponents();
    fixture = TestBed.createComponent(PlanView);
    picks = [];
    fixture.componentInstance.picked.subscribe((pick: PlanPick): number => picks.push(pick));
  });

  it('drawsTheTree_withAColumnForEachFigureTheEngineReported', async () => {
    await show([JOIN]);

    expect(headers()).toEqual(['Step', 'Cost', 'Est. Rows', 'Actual Rows', 'Time (ms)']);
    expect(rows()).toEqual([
      ['Hash Join Inner', '120.5', '100', '90', '2.5'],
      ['Seq Scan on books', '80', '10', '900', '1'],
      ['Hash', '30', '20', '20', ''],
      ['Index Scan on authors', '20', '20', '20', ''],
    ]);
    expect(host().querySelector('.plan__caption')?.textContent).toBe(JOIN.statement);
  });

  it('marksTheActualRows_ofAStepWhoseEstimateWasFarOut', async () => {
    await show([JOIN]);

    const marked: readonly HTMLElement[] = Array.from(
      host().querySelectorAll<HTMLElement>('[data-testid="plan-misestimate"]'),
    );
    expect(marked.map((cell: HTMLElement): string => cell.textContent?.trim() ?? '')).toEqual([
      '900',
    ]);
    expect(marked[0]?.title).toBe('The planner estimated 10 rows, but the step produced 900');
  });

  it('foldsAStep_hidingTheStepsFeedingIt', async () => {
    await show([JOIN]);

    const hash: HTMLElement | undefined = Array.from(
      host().querySelectorAll<HTMLElement>('.table-row'),
    )[2];
    hash?.querySelector<HTMLButtonElement>('[data-testid="tree-twisty"]')?.click();
    await fixture.whenStable();

    expect(rows().map((row: readonly string[]): string => row[0] ?? '')).toEqual([
      'Hash Join Inner',
      'Seq Scan on books',
      'Hash',
    ]);
  });

  it('leavesOutTheFigureColumns_ofAnEngineThatReportsNone', async () => {
    await show([SCAN]);

    expect(headers()).toEqual(['Step']);
    expect(rows()).toEqual([['QUERY PLAN'], ['SCAN t']]);
  });

  it('reportsAPickedStepsFacts_andSelectsIt', async () => {
    await show([JOIN]);

    host().querySelectorAll<HTMLElement>('.table-row')[1]?.click();
    await fixture.whenStable();

    expect(picks[0]?.title).toBe('Seq Scan');
    expect(picks[0]?.properties).toContainEqual({ name: 'Actual rows', value: '900' });
    expect(host().querySelectorAll('.table-row--selected')).toHaveLength(1);
  });

  it('offersAChipPerStatement_namedByItsLineInTheDocument', async () => {
    fixture.componentRef.setInput('firstLine', 10);
    await show([JOIN, SCAN]);

    const chips: readonly HTMLButtonElement[] = Array.from(
      host().querySelectorAll<HTMLButtonElement>('[data-testid="plan-statement"] button'),
    );
    expect(chips.map((chip: HTMLButtonElement): string => chip.textContent?.trim() ?? '')).toEqual([
      'Statement 1 · Line 10',
      'Statement 2 · Line 12',
    ]);

    chips[1]?.click();
    await fixture.whenStable();

    expect(rows()).toEqual([['QUERY PLAN'], ['SCAN t']]);
    expect(chips[1]?.getAttribute('aria-pressed')).toBe('true');
  });

  it('offersNoChips_forASingleStatement', async () => {
    await show([JOIN]);

    expect(host().querySelectorAll('[data-testid="plan-statement"]')).toHaveLength(0);
  });

  it('showsTheEnginesOwnPlan_inTheRawView', async () => {
    await show([JOIN], 'raw');

    const raw: HTMLElement | null = host().querySelector('[data-testid="raw-text"]');
    expect(raw?.textContent).toBe(JOIN.raw);
    expect(raw?.getAttribute('data-language')).toBe('json');
    expect(host().querySelector('[data-testid="plan-tree"]')).toBeNull();
  });
});
