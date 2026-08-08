import { Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Table, TableColumn, TableGroupDef, TableRow, TableRowDef, TableSort } from './table';

@Component({
  imports: [Table, TableRowDef, TableGroupDef],
  template: `
    <app-table
      [columns]="columns()"
      [rows]="rows()"
      [collapsible]="collapsible()"
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
});
