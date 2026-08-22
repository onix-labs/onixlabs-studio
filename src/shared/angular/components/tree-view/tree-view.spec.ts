import { ApplicationRef, Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MenuItem } from '@shared/angular/components/menu/menu';
import { TreeMenuSelection, TreeRow, TreeView } from './tree-view';

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

  it('selectedId_whenSetFromOutside_scrollsTheSelectedRowIntoView', async () => {
    // jsdom has no scrollIntoView; install a recording one on the selected row's prototype.
    const scrolled: string[] = [];
    (
      Element.prototype as unknown as { scrollIntoView: (options?: unknown) => void }
    ).scrollIntoView = function (this: Element): void {
      scrolled.push(this.getAttribute('data-tree-id') ?? '');
    };
    try {
      component.selectedId.set('collapsed');
      // afterRender hooks run on application ticks, not on the fixture's local change detection.
      TestBed.inject(ApplicationRef).tick();
      await fixture.whenStable();

      expect(scrolled).toContain('collapsed');
    } finally {
      delete (Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });
});

/**
 * Hosts the tree with a row context menu, offering items that depend on the row so a test can tell
 * which row the menu was opened on.
 */
@Component({
  imports: [TreeView],
  template: `
    <app-tree-view
      [rows]="rows()"
      [contextMenuFor]="menuFor"
      (contextMenuSelect)="onChoice($event)"
    >
      <ng-template let-row
        ><span class="probe-label">{{ row.data }}</span></ng-template
      >
    </app-tree-view>
  `,
})
class MenuHost {
  public readonly rows: WritableSignal<readonly TreeRow[]> = signal<readonly TreeRow[]>([
    makeRow('alpha', 0, false, false),
    makeRow('beta', 0, false, false),
  ]);
  public readonly chosen: TreeMenuSelection[] = [];

  public readonly menuFor: (row: TreeRow) => readonly MenuItem[] = (
    row: TreeRow,
  ): readonly MenuItem[] => [{ id: `act:${row.id}`, label: `Act on ${row.id}` }];

  public onChoice(selection: TreeMenuSelection): void {
    this.chosen.push(selection);
  }
}

describe('TreeView context menu', () => {
  let fixture: ComponentFixture<MenuHost>;
  let component: MenuHost;

  beforeEach(() => {
    fixture = TestBed.createComponent(MenuHost);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  /**
   * Gets the rendered row elements.
   * @returns Returns the rows.
   */
  function rows(): HTMLElement[] {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.tree-row'),
    );
  }

  /**
   * Gets the items of the open context menu, which the CDK renders into an overlay outside the host.
   * @returns Returns the item buttons.
   */
  function menuItems(): HTMLButtonElement[] {
    return Array.from(document.querySelectorAll<HTMLButtonElement>('.app-menu-panel__item'));
  }

  /**
   * Right-clicks a row and settles the resulting render.
   * @param index The row to right-click.
   */
  function rightClick(index: number): void {
    rows()[index].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
  }

  it('contextMenu_onRightClick_showsTheItemsBuiltForThatRow', () => {
    rightClick(0);
    expect(menuItems().map((b: HTMLButtonElement): string => b.textContent?.trim() ?? '')).toEqual([
      'Act on alpha',
    ]);
  });

  it('contextMenu_onADifferentRow_showsThatRowsItems', () => {
    // The row travels with the trigger's data rather than through a signal set by a separate
    // listener, so the items can never belong to a previously right-clicked row.
    rightClick(1);
    expect(menuItems().map((b: HTMLButtonElement): string => b.textContent?.trim() ?? '')).toEqual([
      'Act on beta',
    ]);
  });

  it('contextMenuSelect_whenAnItemIsChosen_emitsItWithItsRow', () => {
    rightClick(1);
    menuItems()[0].click();
    fixture.detectChanges();

    expect(component.chosen).toHaveLength(1);
    expect(component.chosen[0].itemId).toBe('act:beta');
    expect(component.chosen[0].row.id).toBe('beta');
  });

  it('contextMenu_isAPopupRatherThanAnInlineMenu', () => {
    rightClick(0);

    // The tell for a menu whose `cdkMenu` could not reach its trigger's injector: CDK falls back to
    // treating it as an inline menu, which builds its own menu stack. The panel then cannot be
    // dismissed by its trigger and lays out as a stretched strip instead of a popup. Asserted on the
    // class because that is the one visible symptom of the injector chain being wrong.
    const panel: Element | null = document.querySelector('.app-menu-panel');
    expect(panel).not.toBeNull();
    expect(panel?.classList.contains('cdk-menu-inline')).toBe(false);
  });

  it('contextMenu_whenClickingAway_dismissesIt', () => {
    rightClick(0);
    expect(menuItems()).toHaveLength(1);

    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();

    expect(menuItems()).toHaveLength(0);
  });

  it('contextMenu_whenClickingAnotherRow_dismissesIt', () => {
    // Clicking a row is the ordinary way out of a context menu — opening a file, say — so it has to
    // dismiss the menu rather than leave it stranded over the tree.
    rightClick(0);
    expect(menuItems()).toHaveLength(1);

    rows()[1].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    rows()[1].click();
    fixture.detectChanges();

    expect(menuItems()).toHaveLength(0);
  });
});

/**
 * Hosts the tree with a context menu that only some rows have items for, so the suppression of empty
 * menus can be observed.
 */
@Component({
  imports: [TreeView],
  template: `
    <app-tree-view [rows]="rows()" [contextMenuFor]="menuFor">
      <ng-template let-row
        ><span class="probe-label">{{ row.data }}</span></ng-template
      >
    </app-tree-view>
  `,
})
class SparseMenuHost {
  public readonly rows: WritableSignal<readonly TreeRow[]> = signal<readonly TreeRow[]>([
    makeRow('actionable', 0, false, false),
    makeRow('inert', 0, false, false),
  ]);

  public readonly menuFor: (row: TreeRow) => readonly MenuItem[] = (
    row: TreeRow,
  ): readonly MenuItem[] => (row.id === 'actionable' ? [{ id: 'act', label: 'Act' }] : []);
}

describe('TreeView context menu suppression', () => {
  let fixture: ComponentFixture<SparseMenuHost>;

  beforeEach(() => {
    fixture = TestBed.createComponent(SparseMenuHost);
    fixture.detectChanges();
  });

  /**
   * Right-clicks the row at the given index.
   * @param index The row index.
   */
  function rightClick(index: number): void {
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.tree-row'))[
      index
    ].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
  }

  it('contextMenu_onARowWithItems_opens', () => {
    rightClick(0);
    expect(document.querySelectorAll('.app-menu-panel__item')).toHaveLength(1);
  });

  it('contextMenu_onARowWithNoItems_doesNotOpenAnEmptyPanel', () => {
    // An empty panel on a row nothing can be done to reads as a bug rather than as an answer.
    rightClick(1);
    expect(document.querySelectorAll('.app-menu-panel')).toHaveLength(0);
  });
});
