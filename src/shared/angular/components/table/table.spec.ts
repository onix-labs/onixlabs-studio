import { Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  Table,
  TableColumn,
  TableGridlines,
  TableGridlineTone,
  TableGroupDef,
  TableRow,
  TableRowDef,
  TableRowSize,
  TableSort,
} from './table';

@Component({
  imports: [Table, TableRowDef, TableGroupDef],
  template: `
    <app-table
      [columns]="columns()"
      [rows]="rows()"
      [collapsible]="collapsible()"
      [striped]="striped()"
      [rowSize]="rowSize()"
      [virtual]="virtual()"
      [resizable]="resizable()"
      [gridlines]="gridlines()"
      [gridlineTone]="gridlineTone()"
      emptyText="Nothing here."
      (rowClick)="onRow($event)"
      (sortChange)="onSort($event)"
    >
      <ng-template appTableGroup let-row>
        <span class="probe-group">{{ $any(row.data).label }}</span>
      </ng-template>
      <ng-template appTableRow let-row>
        <td class="probe-name">{{ $any(row.data).name }}</td>
        <td class="probe-value">{{ $any(row.data).value }}</td>
      </ng-template>
    </app-table>
  `,
})
class TestHost {
  public readonly columns: WritableSignal<readonly TableColumn[]> = signal<readonly TableColumn[]>([
    { id: 'name', header: 'Name', sortable: true },
    { id: 'value', header: 'Value', align: 'end', width: '6rem' },
  ]);
  public readonly rows: WritableSignal<readonly TableRow[]> = signal<readonly TableRow[]>([
    { id: 'g1', group: true, data: { label: 'Group one' } },
    { id: 'r1', data: { name: 'alpha', value: '1' } },
    { id: 'r2', data: { name: 'beta', value: '2' } },
  ]);
  public readonly collapsible: WritableSignal<boolean> = signal<boolean>(false);
  public readonly striped: WritableSignal<boolean> = signal<boolean>(false);
  public readonly rowSize: WritableSignal<TableRowSize> = signal<TableRowSize>('compact');
  public readonly virtual: WritableSignal<boolean> = signal<boolean>(false);
  public readonly resizable: WritableSignal<boolean> = signal<boolean>(false);
  public readonly gridlines: WritableSignal<TableGridlines> = signal<TableGridlines>('none');
  public readonly gridlineTone: WritableSignal<TableGridlineTone> =
    signal<TableGridlineTone>('light');
  public readonly clicked: TableRow[] = [];
  public readonly sorts: (TableSort | null)[] = [];

  public onRow(row: TableRow): void {
    this.clicked.push(row);
  }

  public onSort(sort: TableSort | null): void {
    this.sorts.push(sort);
  }
}

describe('Table', () => {
  let fixture: ComponentFixture<TestHost>;
  let component: TestHost;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TestHost] }).compileComponents();
    fixture = TestBed.createComponent(TestHost);
    component = fixture.componentInstance;
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  it('renders a header cell per column', () => {
    const headers: HTMLElement[] = Array.from(host.querySelectorAll<HTMLElement>('thead th'));
    expect(headers.map((cell: HTMLElement): string => cell.textContent?.trim() ?? '')).toEqual([
      'Name',
      'Value',
    ]);
  });

  it('rowSize_isCompactByDefault_andComfortableWhenAsked', () => {
    // The manager tools' lists take their taller rows from the table itself, not from their own
    // styles, so they cannot drift apart.
    const table: () => HTMLElement = (): HTMLElement =>
      (fixture.nativeElement as HTMLElement).querySelector('table.table')!;
    expect(table().classList.contains('table--comfortable')).toBe(false);

    fixture.componentInstance.rowSize.set('comfortable');
    fixture.detectChanges();

    expect(table().classList.contains('table--comfortable')).toBe(true);
  });

  it('renders data rows through the projected row template', () => {
    const names: HTMLElement[] = Array.from(host.querySelectorAll<HTMLElement>('.probe-name'));
    expect(names.map((cell: HTMLElement): string => cell.textContent?.trim() ?? '')).toEqual([
      'alpha',
      'beta',
    ]);
  });

  it('renders a group row spanning every column through the group template', () => {
    const group: HTMLElement | null = host.querySelector<HTMLElement>('.table-group__cell');
    expect(group?.getAttribute('colspan')).toBe('2');
    expect(host.querySelector('.probe-group')?.textContent?.trim()).toBe('Group one');
  });

  it('emits the clicked row', () => {
    const firstDataRow: HTMLElement = fixture.debugElement.queryAll(By.css('.table-row'))[0]
      .nativeElement as HTMLElement;
    firstDataRow.click();
    expect(component.clicked.map((row: TableRow): string => row.id)).toEqual(['r1']);
  });

  it('shows the empty text when there are no rows', () => {
    component.rows.set([]);
    fixture.detectChanges();
    expect(host.querySelector('.table-empty')?.textContent?.trim()).toBe('Nothing here.');
  });

  it('renders a sort button only on sortable columns', () => {
    const headers: HTMLElement[] = Array.from(host.querySelectorAll<HTMLElement>('thead th'));
    expect(headers[0].querySelector('.table-th__button')).not.toBeNull();
    expect(headers[1].querySelector('.table-th__button')).toBeNull();
  });

  it('cycles a sortable header through ascending, descending, then unsorted', () => {
    const button: HTMLElement = host.querySelector<HTMLElement>('.table-th__button')!;
    button.click();
    fixture.detectChanges();
    button.click();
    fixture.detectChanges();
    button.click();
    fixture.detectChanges();
    expect(component.sorts).toEqual([
      { columnId: 'name', direction: 'asc' },
      { columnId: 'name', direction: 'desc' },
      null,
    ]);
  });

  it('reflects the active sort on the header via aria-sort', () => {
    const nameHeader: HTMLElement = host.querySelectorAll<HTMLElement>('thead th')[0];
    expect(nameHeader.getAttribute('aria-sort')).toBe('none');
    host.querySelector<HTMLElement>('.table-th__button')!.click();
    fixture.detectChanges();
    expect(nameHeader.getAttribute('aria-sort')).toBe('ascending');
  });

  /**
   * Gets which rendered data rows are shaded as the alternate stripe.
   * @returns Returns one flag per data row, in order.
   */
  function stripes(): boolean[] {
    return Array.from(host.querySelectorAll<HTMLElement>('tr.table-row')).map(
      (row: HTMLElement): boolean => row.classList.contains('table-row--alternate'),
    );
  }

  it('shades no rows until the table is striped', () => {
    expect(stripes()).toEqual([false, false]);
  });

  it('stripes every second row, starting again under each group', () => {
    component.rows.set([
      { id: 'g1', group: true, data: { label: 'One' } },
      { id: 'a', data: { name: 'a', value: '1' } },
      { id: 'b', data: { name: 'b', value: '2' } },
      { id: 'c', data: { name: 'c', value: '3' } },
      { id: 'g2', group: true, data: { label: 'Two' } },
      { id: 'd', data: { name: 'd', value: '4' } },
      { id: 'e', data: { name: 'e', value: '5' } },
    ]);
    component.striped.set(true);
    fixture.detectChanges();

    expect(stripes()).toEqual([false, true, false, false, true]);
  });

  it('shows no twisty until the table is collapsible', () => {
    expect(host.querySelector('.table-group__twisty')).toBeNull();
    component.collapsible.set(true);
    fixture.detectChanges();
    expect(host.querySelector('.table-group__twisty')).not.toBeNull();
  });

  it('collapses a group, hiding its data rows, and expands it again', () => {
    component.collapsible.set(true);
    fixture.detectChanges();
    expect(host.querySelectorAll('.probe-name').length).toBe(2);

    const twisty: HTMLElement = host.querySelector<HTMLElement>('.table-group__twisty')!;
    twisty.click();
    fixture.detectChanges();
    expect(host.querySelectorAll('.probe-name').length).toBe(0);
    expect(host.querySelector('.probe-group')).not.toBeNull();

    twisty.click();
    fixture.detectChanges();
    expect(host.querySelectorAll('.probe-name').length).toBe(2);
  });

  it('does not emit a row click when the twisty is used', () => {
    component.collapsible.set(true);
    fixture.detectChanges();
    host.querySelector<HTMLElement>('.table-group__twisty')!.click();
    expect(component.clicked).toEqual([]);
  });

  describe('virtual', () => {
    /**
     * Gives the host 500 data rows.
     */
    function manyRows(): void {
      component.rows.set(
        Array.from({ length: 500 }, (_: unknown, index: number): TableRow => ({
          id: `r${index}`,
          data: { name: `row ${index}`, value: String(index) },
        })),
      );
    }

    /**
     * Gets the heights of the spacer rows, top then bottom.
     * @returns Returns the heights in pixels.
     */
    function spacers(): string[] {
      return Array.from(host.querySelectorAll<HTMLElement>('.table-spacer td')).map(
        (cell: HTMLElement): string => cell.style.height,
      );
    }

    it('rendersEveryRow_whenOff', () => {
      manyRows();
      fixture.detectChanges();
      expect(host.querySelectorAll('.table-row').length).toBe(500);
      expect(spacers()).toEqual([]);
    });

    it('rendersOnlyTheFirstWindow_andStandsInForTheRest_beforeTheAreaIsMeasured', () => {
      // #980 P5: a 5,000-record log rendered every row; a virtual table renders a screenful.
      manyRows();
      component.virtual.set(true);
      fixture.detectChanges();

      // 60 unmeasured rows, a 10-row step and a 20-row overscan, at the estimated 24px a row.
      expect(host.querySelectorAll('.table-row').length).toBe(90);
      expect(host.querySelector('.probe-name')?.textContent?.trim()).toBe('row 0');
      expect(spacers()).toEqual([`${410 * 24}px`]);
    });

    it('movesTheWindow_withTheScrollPosition', () => {
      manyRows();
      component.virtual.set(true);
      fixture.detectChanges();
      const scroller: HTMLElement = host.querySelector<HTMLElement>('.table-scroll')!;
      expect(scroller.classList).toContain('table-scroll--virtual');
      Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 240 });
      Object.defineProperty(scroller, 'scrollTop', { configurable: true, value: 2400 });

      scroller.dispatchEvent(new Event('scroll'));
      fixture.detectChanges();

      // Row 100 is at the top: rows 80–139 render (a 20-row overscan above, the 10 visible, a step
      // and the overscan below), and the rest is spacer.
      const names: string[] = Array.from(host.querySelectorAll<HTMLElement>('.probe-name')).map(
        (cell: HTMLElement): string => cell.textContent?.trim() ?? '',
      );
      expect(names[0]).toBe('row 80');
      expect(names.at(-1)).toBe('row 139');
      expect(spacers()).toEqual([`${80 * 24}px`, `${360 * 24}px`]);
    });

    it('stillShowsTheEmptyText_withNoRows', () => {
      component.virtual.set(true);
      component.rows.set([]);
      fixture.detectChanges();
      expect(host.querySelector('.table-empty')?.textContent?.trim()).toBe('Nothing here.');
      expect(spacers()).toEqual([]);
    });
  });

  describe('resizable columns', () => {
    /**
     * Sends a pointer event of the given type to an element.
     * @param target The element.
     * @param type The event type.
     * @param clientX The pointer's x position.
     */
    function pointer(target: Element, type: string, clientX: number): void {
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX }));
    }

    it('drawsNoGripsAndNoFiller_unlessAsked', () => {
      expect(host.querySelectorAll('.table-th__grip')).toHaveLength(0);
      expect(host.querySelector('.table-th--filler')).toBeNull();
      expect(host.querySelectorAll('colgroup col')).toHaveLength(2);
    });

    it('givesEveryColumnAGrip_andEndsWithAFillerThatHasNone', () => {
      component.resizable.set(true);
      fixture.detectChanges();

      // One grip per real column; the filler column takes what is left and cannot be resized.
      expect(host.querySelectorAll('.table-th__grip')).toHaveLength(2);
      expect(host.querySelector('.table-th--filler .table-th__grip')).toBeNull();
      expect(host.querySelectorAll('colgroup col')).toHaveLength(3);
      expect(host.querySelectorAll('.table-row .table-filler')).toHaveLength(2);
      // A full-width row spans the filler too, so a group header reaches the right edge.
      expect(host.querySelector('.table-group__cell')?.getAttribute('colspan')).toBe('3');
    });

    it('resizesTheColumnWhoseEdgeIsDragged_andNeverBelowTheFloor', () => {
      component.resizable.set(true);
      fixture.detectChanges();
      const grip: Element = host.querySelectorAll('.table-th__grip')[0];

      pointer(grip, 'pointerdown', 100);
      pointer(grip, 'pointermove', 260);
      pointer(grip, 'pointerup', 260);
      fixture.detectChanges();

      const cols: HTMLElement[] = Array.from(host.querySelectorAll<HTMLElement>('colgroup col'));
      // The test DOM measures every heading at 0px, so the dragged column is the drag's 160px.
      expect(cols[0].style.width).toBe('160px');
      // The table is never narrower than its scroll area, however small the columns are dragged.
      expect(host.querySelector<HTMLElement>('table.table')?.style.inlineSize).toContain(
        'max(100%',
      );

      pointer(grip, 'pointerdown', 300);
      pointer(grip, 'pointermove', 0);
      pointer(grip, 'pointerup', 0);
      fixture.detectChanges();
      expect(cols[0].style.width).toBe('40px');
    });

    it('startsANewSetOfColumnsFromTheirStatedWidths', () => {
      component.resizable.set(true);
      fixture.detectChanges();
      const grip: Element = host.querySelectorAll('.table-th__grip')[1];
      pointer(grip, 'pointerdown', 0);
      pointer(grip, 'pointermove', 200);
      pointer(grip, 'pointerup', 200);
      fixture.detectChanges();

      component.columns.set([
        { id: 'other', header: 'Other' },
        { id: 'more', header: 'More', width: '9rem' },
      ]);
      fixture.detectChanges();

      const cols: HTMLElement[] = Array.from(host.querySelectorAll<HTMLElement>('colgroup col'));
      expect(cols[1].style.width).toBe('9rem');
      expect(host.querySelector<HTMLElement>('table.table')?.style.inlineSize).toBe('');
    });
  });

  it('gridlines_drawRowsThenAFullGrid_inEitherTone', () => {
    const table: () => HTMLElement = (): HTMLElement => host.querySelector('table.table')!;
    expect(table().classList.contains('table--rows')).toBe(false);

    component.gridlines.set('horizontal');
    fixture.detectChanges();
    expect(table().classList.contains('table--rows')).toBe(true);
    expect(table().classList.contains('table--grid')).toBe(false);

    component.gridlines.set('full');
    component.gridlineTone.set('dark');
    fixture.detectChanges();
    expect(table().classList.contains('table--grid')).toBe(true);
    expect(table().classList.contains('table--dark-lines')).toBe(true);
  });
});
