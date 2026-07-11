import { Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TreeRow, TreeView } from './tree-view';

/**
 * Builds a tree row with the given identity, depth, and expansion state, carrying its id as the
 * payload the projected template renders.
 * @param id The row's stable identity.
 * @param depth The row's depth beneath the root.
 * @param expandable Whether the row can be expanded.
 * @param expanded Whether the row is currently expanded.
 * @returns Returns the tree row.
 */
function makeRow(id: string, depth: number, expandable: boolean, expanded: boolean): TreeRow {
  return { id, depth, expandable, expanded, data: id };
}

@Component({
  imports: [TreeView],
  template: `
    <app-tree-view [rows]="rows()" [selectedId]="selectedId()" (rowClick)="onRow($event)">
      <ng-template let-row
        ><span class="probe-label">{{ row.data }}</span></ng-template
      >
    </app-tree-view>
  `,
})
class TestHost {
  public readonly rows: WritableSignal<readonly TreeRow[]> = signal<readonly TreeRow[]>([
    makeRow('root', 0, true, true),
    makeRow('child', 1, false, false),
    makeRow('collapsed', 0, true, false),
  ]);
  public readonly selectedId: WritableSignal<string | null> = signal<string | null>(null);
  public readonly clicked: TreeRow[] = [];

  public onRow(row: TreeRow): void {
    this.clicked.push(row);
  }
}

describe('TreeView', () => {
  let fixture: ComponentFixture<TestHost>;
  let component: TestHost;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHost],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHost);
    component = fixture.componentInstance;
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  /**
   * Gets the rendered tree rows in order.
   * @returns Returns the row elements.
   */
  function rowElements(): readonly HTMLElement[] {
    return Array.from(host.querySelectorAll<HTMLElement>('.tree-row'));
  }

  it('render_showsARowPerEntryWithTheProjectedContent', () => {
    const labels: (string | null)[] = Array.from(host.querySelectorAll('.probe-label')).map(
      (element: Element): string | null => element.textContent,
    );

    expect(rowElements().length).toBe(3);
    expect(labels).toEqual(['root', 'child', 'collapsed']);
  });

  it('indentFor_deeperRowsGetMoreLeftPadding', () => {
    const rows: readonly HTMLElement[] = rowElements();

    expect(rows[0].style.paddingLeft).toBe('8px');
    expect(rows[1].style.paddingLeft).toBe('22px');
  });

  it('render_expandableRowsShowAChevronAndReportExpansionWhileLeavesShowASpacer', () => {
    const rows: readonly HTMLElement[] = rowElements();

    expect(rows[0].querySelector('.tree-chevron')).not.toBeNull();
    expect(rows[0].getAttribute('aria-expanded')).toBe('true');
    expect(rows[2].getAttribute('aria-expanded')).toBe('false');
    expect(rows[1].querySelector('.tree-chevron')).toBeNull();
    expect(rows[1].querySelector('.tree-spacer')).not.toBeNull();
    expect(rows[1].getAttribute('aria-expanded')).toBeNull();
  });

  it('rowClick_whenARowIsClicked_emitsThatRow', () => {
    rowElements()[1].click();

    expect(component.clicked.length).toBe(1);
    expect(component.clicked[0].id).toBe('child');
  });

  it('activate_whenEnterIsPressedOnARow_emitsThatRow', () => {
    rowElements()[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(component.clicked.length).toBe(1);
    expect(component.clicked[0].id).toBe('collapsed');
  });

  it('selectedId_whenSet_marksOnlyThatRowActiveAndSelected', () => {
    component.selectedId.set('child');
    fixture.detectChanges();

    const rows: readonly HTMLElement[] = rowElements();
    expect(rows[1].classList).toContain('active');
    expect(rows[1].getAttribute('aria-selected')).toBe('true');
    expect(rows[0].classList).not.toContain('active');
    expect(rows[0].getAttribute('aria-selected')).toBe('false');
  });
});
