import { Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { Table, TableColumn, TableRow, TableRowDef, TableRowSelect } from '../table';
import { TableTreeCell } from './table-tree-cell';

/**
 * One row of the test tree.
 */
interface TreeData {
  readonly name: string;
}

/**
 * A tree table: a root with two children, the first of which has a child of its own.
 */
@Component({
  imports: [Table, TableRowDef, TableTreeCell],
  template: `
    <app-table
      [columns]="columns"
      [rows]="rows()"
      [collapsible]="collapsible()"
      (rowSelect)="selects.push($event)"
    >
      <ng-template appTableRow let-row let-tree="tree">
        <td>
          <app-table-tree-cell [tree]="tree">
            <span data-testid="name">{{ $any(row.data).name }}</span>
          </app-table-tree-cell>
        </td>
        <td>-</td>
      </ng-template>
    </app-table>
  `,
})
class TreeHost {
  public readonly columns: readonly TableColumn[] = [
    { id: 'name', header: 'Name' },
    { id: 'size', header: 'Size' },
  ];
  public readonly rows: WritableSignal<readonly TableRow[]> = signal<readonly TableRow[]>([
    { id: 'root', depth: 0, data: { name: 'root' } satisfies TreeData },
    { id: 'a', depth: 1, data: { name: 'a' } satisfies TreeData },
    { id: 'a1', depth: 2, data: { name: 'a1' } satisfies TreeData },
    { id: 'b', depth: 1, data: { name: 'b' } satisfies TreeData },
  ]);
  public readonly collapsible: WritableSignal<boolean> = signal<boolean>(true);
  public readonly selects: TableRowSelect[] = [];
}

describe('TableTreeCell', () => {
  let fixture: ComponentFixture<TreeHost>;
  let host: TreeHost;

  /**
   * Reads the names of the rows rendered.
   * @returns Returns them in order.
   */
  function names(): readonly string[] {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('[data-testid="name"]'),
    ).map((cell: HTMLElement): string => cell.textContent?.trim() ?? '');
  }

  /**
   * Finds the twisty of a row.
   * @param name The row's name.
   * @returns Returns the twisty, or null when the row has none.
   */
  function twisty(name: string): HTMLButtonElement | null {
    const cell: HTMLElement | undefined = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.table-row'),
    ).find((row: HTMLElement): boolean => row.textContent?.trim().startsWith(name) === true);
    return cell?.querySelector<HTMLButtonElement>('[data-testid="tree-twisty"]') ?? null;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TreeHost] }).compileComponents();
    fixture = TestBed.createComponent(TreeHost);
    host = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('indents each row by its depth', () => {
    const depths: readonly string[] = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.tree-cell'),
    ).map((cell: HTMLElement): string => cell.style.getPropertyValue('--tree-depth'));

    expect(depths).toEqual(['0', '1', '2', '1']);
  });

  it('draws a twisty only on rows with rows beneath them', () => {
    expect(twisty('root')).not.toBeNull();
    expect(twisty('a')).not.toBeNull();
    expect(twisty('a1')).toBeNull();
    expect(twisty('b')).toBeNull();
  });

  it('folds a row, hiding every deeper row after it, and unfolds it again', async () => {
    twisty('a')?.click();
    await fixture.whenStable();

    expect(names()).toEqual(['root', 'a', 'b']);
    expect(twisty('a')?.getAttribute('aria-expanded')).toBe('false');
    expect(twisty('a')?.getAttribute('aria-label')).toBe('Expand');

    twisty('a')?.click();
    await fixture.whenStable();

    expect(names()).toEqual(['root', 'a', 'a1', 'b']);
    expect(twisty('a')?.getAttribute('aria-label')).toBe('Collapse');
  });

  it('folds the whole tree under the root', async () => {
    twisty('root')?.click();
    await fixture.whenStable();

    expect(names()).toEqual(['root']);
  });

  it('does not select the row when the twisty is pressed', async () => {
    twisty('root')?.click();
    await fixture.whenStable();

    expect(host.selects).toEqual([]);
  });

  it('draws no twisty and folds nothing in a table that is not collapsible', async () => {
    host.collapsible.set(false);
    await fixture.whenStable();

    expect(twisty('root')).toBeNull();
    expect(names()).toEqual(['root', 'a', 'a1', 'b']);
  });
});
