import { CdkDragDrop, CdkDragSortEvent } from '@angular/cdk/drag-drop';
import { ApplicationRef, Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ListReorder, ListRow, ListView } from './list-view';

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

  it('reorderable_whenOff_rendersNoGripHandles', () => {
    expect(host.querySelectorAll('.list-row__grip').length).toBe(0);
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

@Component({
  imports: [ListView],
  template: `
    <app-list-view [rows]="rows()" [reorderable]="true" (reorder)="onReorder($event)">
      <ng-template let-row
        ><span class="probe-label">{{ row.data }}</span></ng-template
      >
    </app-list-view>
  `,
})
class ReorderableHost {
  public readonly rows: WritableSignal<readonly ListRow[]> = signal<readonly ListRow[]>([
    makeRow('one'),
    makeRow('two'),
    makeRow('three'),
  ]);
  public readonly reordered: ListReorder[] = [];

  public onReorder(event: ListReorder): void {
    this.reordered.push(event);
  }
}

describe('ListView (reorderable)', () => {
  let fixture: ComponentFixture<ReorderableHost>;
  let component: ReorderableHost;
  let host: HTMLElement;
  let list: ListView;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReorderableHost],
    }).compileComponents();

    fixture = TestBed.createComponent(ReorderableHost);
    component = fixture.componentInstance;
    host = fixture.nativeElement as HTMLElement;
    list = fixture.debugElement.query(By.directive(ListView)).componentInstance as ListView;
    fixture.detectChanges();
  });

  it('render_growsAGripHandlePerRow', () => {
    expect(host.querySelectorAll('.list-row__grip').length).toBe(3);
    expect(host.querySelector('.list-row__grip')?.getAttribute('aria-label')).toBe(
      'Drag to reorder',
    );
  });

  /**
   * Drives the drag surface (the private handlers the CDK bindings call) for a reorder test.
   * @param list The list view under test.
   * @returns Returns the drag handlers cast off the component.
   */
  function drag(list: ListView): {
    onDragStarted(): void;
    onSorted(event: CdkDragSortEvent<readonly ListRow[]>): void;
    onDrop(event: CdkDragDrop<readonly ListRow[]>): void;
  } {
    return list as unknown as {
      onDragStarted(): void;
      onSorted(event: CdkDragSortEvent<readonly ListRow[]>): void;
      onDrop(event: CdkDragDrop<readonly ListRow[]>): void;
    };
  }

  it('onSorted_emitsAMoveLiveForTheStep_mappingIndicesToRowIds', () => {
    drag(list).onDragStarted();
    drag(list).onSorted({
      previousIndex: 2,
      currentIndex: 0,
    } as CdkDragSortEvent<readonly ListRow[]>);

    // The reorder is emitted during the drag (not on drop) so the consumer's order updates live.
    expect(component.reordered).toEqual([{ from: 'three', to: 'one' }]);
  });

  it('onSorted_acrossSuccessiveSteps_advancesTheMirrorSoTheIdsStayCorrect', () => {
    drag(list).onDragStarted();
    // three: index 2 -> 1, then 1 -> 0. The moved id stays 'three' as the mirror order advances.
    drag(list).onSorted({ previousIndex: 2, currentIndex: 1 } as CdkDragSortEvent<
      readonly ListRow[]
    >);
    drag(list).onSorted({ previousIndex: 1, currentIndex: 0 } as CdkDragSortEvent<
      readonly ListRow[]
    >);

    expect(component.reordered).toEqual([
      { from: 'three', to: 'two' },
      { from: 'three', to: 'one' },
    ]);
  });

  it('onSorted_whenAStepLandsInPlace_emitsNothing', () => {
    drag(list).onDragStarted();
    drag(list).onSorted({
      previousIndex: 1,
      currentIndex: 1,
    } as CdkDragSortEvent<readonly ListRow[]>);

    expect(component.reordered).toEqual([]);
  });

  it('onDrop_afterALiveDrag_emitsNothingFurther', () => {
    drag(list).onDragStarted();
    drag(list).onSorted({ previousIndex: 2, currentIndex: 0 } as CdkDragSortEvent<
      readonly ListRow[]
    >);
    component.reordered.length = 0;

    drag(list).onDrop({ previousIndex: 2, currentIndex: 0 } as CdkDragDrop<readonly ListRow[]>);

    expect(component.reordered).toEqual([]);
  });

  it('duringADrag_rendersTheFrozenSnapshot_thenTheLiveRowsOnDrop', () => {
    const labels: () => string[] = (): string[] =>
      [...host.querySelectorAll('.probe-label')].map((node: Element): string =>
        (node.textContent ?? '').trim(),
      );
    expect(labels()).toEqual(['one', 'two', 'three']);

    // While dragging, a live reorder of the input must not re-order this list's own DOM (the toolkit
    // is moving those elements); the frozen snapshot is rendered instead.
    drag(list).onDragStarted();
    component.rows.set([makeRow('three'), makeRow('one'), makeRow('two')]);
    fixture.detectChanges();
    expect(labels()).toEqual(['one', 'two', 'three']);

    // On drop the snapshot is released and the settled live order is rendered.
    drag(list).onDrop({ previousIndex: 0, currentIndex: 0 } as CdkDragDrop<readonly ListRow[]>);
    fixture.detectChanges();
    expect(labels()).toEqual(['three', 'one', 'two']);
  });
});
