import { ApplicationRef, Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ListRow, ListView } from './list-view';

/**
 * Builds a list row carrying its id as the payload the projected template renders.
 * @param id The row's stable identity.
 * @returns Returns the list row.
 */
function makeRow(id: string): ListRow {
  return { id, data: id };
}

@Component({
  imports: [ListView],
  template: `
    <app-list-view
      [rows]="rows()"
      [selectedId]="selectedId()"
      emptyText="Nothing here yet."
      (rowClick)="onRow($event)"
    >
      <ng-template let-row
        ><span class="probe-label">{{ row.data }}</span></ng-template
      >
    </app-list-view>
  `,
})
class TestHost {
  public readonly rows: WritableSignal<readonly ListRow[]> = signal<readonly ListRow[]>([
    makeRow('one'),
    makeRow('two'),
    makeRow('three'),
  ]);
  public readonly selectedId: WritableSignal<string | null> = signal<string | null>(null);
  public readonly clicked: ListRow[] = [];

  public onRow(row: ListRow): void {
    this.clicked.push(row);
  }
}

describe('ListView', () => {
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
   * Gets the rendered list rows in order.
   * @returns Returns the row elements.
   */
  function rowElements(): readonly HTMLElement[] {
    return Array.from(host.querySelectorAll<HTMLElement>('.list-row'));
  }

  it('render_showsARowPerEntryWithTheProjectedContent', () => {
    const labels: (string | null)[] = Array.from(host.querySelectorAll('.probe-label')).map(
      (element: Element): string | null => element.textContent,
    );

    expect(rowElements().length).toBe(3);
    expect(labels).toEqual(['one', 'two', 'three']);
  });

  it('render_withNoRows_showsTheEmptyText', () => {
    component.rows.set([]);
    fixture.detectChanges();

    expect(rowElements().length).toBe(0);
    expect(host.querySelector('.list-empty')?.textContent).toContain('Nothing here yet.');
  });

  it('rowClick_whenARowIsClicked_emitsThatRow', () => {
    rowElements()[1].click();

    expect(component.clicked.length).toBe(1);
    expect(component.clicked[0].id).toBe('two');
  });

  it('activate_whenEnterIsPressedOnARow_emitsThatRow', () => {
    rowElements()[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(component.clicked.length).toBe(1);
    expect(component.clicked[0].id).toBe('three');
  });

  it('selectedId_whenSet_marksOnlyThatRowActiveAndSelected', () => {
    component.selectedId.set('two');
    fixture.detectChanges();

    const rows: readonly HTMLElement[] = rowElements();
    expect(rows[1].classList).toContain('active');
    expect(rows[1].getAttribute('aria-selected')).toBe('true');
    expect(rows[0].classList).not.toContain('active');
    expect(rows[0].getAttribute('aria-selected')).toBe('false');
  });

  it('selectedId_whenSetFromOutside_scrollsTheSelectedRowIntoView', async () => {
    // jsdom has no scrollIntoView; install a recording one on the element prototype.
    const scrolled: string[] = [];
    (
      Element.prototype as unknown as { scrollIntoView: (options?: unknown) => void }
    ).scrollIntoView = function (this: Element): void {
      scrolled.push(this.getAttribute('data-list-id') ?? '');
    };
    try {
      component.selectedId.set('three');
      // afterRender hooks run on application ticks, not on the fixture's local change detection.
      TestBed.inject(ApplicationRef).tick();
      await fixture.whenStable();

      expect(scrolled).toContain('three');
    } finally {
      delete (Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });
});
