import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PropertyGrid, PropertyGridEdit, PropertyGridRow } from './property-grid';

describe('PropertyGrid', () => {
  let component: PropertyGrid;
  let fixture: ComponentFixture<PropertyGrid>;

  /**
   * Renders the grid for the given rows.
   * @param rows The rows to edit.
   * @param checkable Whether the tick column is shown.
   */
  function render(rows: readonly PropertyGridRow[], checkable: boolean = true): void {
    fixture.componentRef.setInput('rows', rows);
    fixture.componentRef.setInput('checkable', checkable);
    fixture.detectChanges();
  }

  /**
   * Reads the grid's text inputs, which run name, value, name, value… in row order.
   * @returns Returns the rendered inputs.
   */
  function inputs(): HTMLInputElement[] {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    return [...element.querySelectorAll<HTMLInputElement>('app-text-field input')];
  }

  /**
   * Types into an input, as the underlying control's `input` handler does.
   * @param input The input to type into.
   * @param text The text to type.
   */
  function type(input: HTMLInputElement, text: string): void {
    input.value = text;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [PropertyGrid] }).compileComponents();
    fixture = TestBed.createComponent(PropertyGrid);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    render([]);
    expect(component).toBeTruthy();
  });

  it('render_whenGivenRows_showsEachRowPlusABlankOne', () => {
    render([
      { id: 'a', name: 'page', value: '1' },
      { id: 'b', name: 'size', value: '20' },
    ]);

    // Two stored rows and the blank row: two inputs each.
    expect(inputs()).toHaveLength(6);
    expect(inputs()[0].value).toBe('page');
    expect(inputs()[4].value).toBe('');
  });

  it('render_drawsAGridOfCellsWithEditorsThatFillThem', () => {
    render([{ id: 'a', name: 'page', value: '1' }]);

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    // A header row and two data rows (the stored one and the blank one), each a row of cells.
    expect(element.querySelectorAll('[role="row"]')).toHaveLength(3);
    expect(element.querySelectorAll('[role="columnheader"]')).toHaveLength(2);
    // The editors draw no box of their own: the cell is the box, which is what makes this read as a
    // grid rather than as a column of form fields.
    const field: HTMLElement = element.querySelector<HTMLElement>('app-text-field')!;
    expect(field.classList.contains('text-field--seamless')).toBe(true);
  });

  it('render_whenNotCheckable_omitsTheTickColumn', () => {
    render([{ id: 'a', name: 'page', value: '1' }], false);

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('app-checkbox')).toBeNull();
  });

  it('rowChange_whenAnExistingRowIsEdited_reportsTheChangeAgainstItsId', () => {
    const edits: PropertyGridEdit[] = [];
    render([{ id: 'a', name: 'page', value: '1' }]);
    component.rowChange.subscribe((edit: PropertyGridEdit): void => {
      edits.push(edit);
    });

    type(inputs()[1], '2');

    expect(edits).toEqual([{ id: 'a', value: '2' }]);
  });

  it('rowChange_whenARowIsUnticked_reportsTheTick', () => {
    const edits: PropertyGridEdit[] = [];
    render([{ id: 'a', name: 'page', value: '1' }]);
    component.rowChange.subscribe((edit: PropertyGridEdit): void => {
      edits.push(edit);
    });

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const tick: HTMLInputElement = element.querySelector<HTMLInputElement>('app-checkbox input')!;
    tick.checked = false;
    tick.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(edits).toEqual([{ id: 'a', enabled: false }]);
  });

  it('add_whenTheBlankRowIsTypedInto_handsOutTheIdItIsAlreadyRenderedUnder', () => {
    const added: PropertyGridRow[] = [];
    render([{ id: 'a', name: 'page', value: '1' }]);
    component.add.subscribe((row: PropertyGridRow): void => {
      added.push(row);
    });
    const blankId: string = blankRowId();

    type(inputs()[2], 'size');

    expect(added).toEqual([{ id: blankId, name: 'size', value: '', enabled: true }]);
    // Adopting that id is what keeps the caret in place, so the consumer must be given it before the
    // row exists — and the next blank row must then be a different row.
    render([
      { id: 'a', name: 'page', value: '1' },
      { id: blankId, name: 'size', value: '' },
    ]);
    expect(blankRowId()).not.toBe(blankId);
  });

  it('remove_whenARowsRemoveButtonIsPressed_reportsThatRow', () => {
    const removed: string[] = [];
    render([{ id: 'a', name: 'page', value: '1' }]);
    component.remove.subscribe((id: string): void => {
      removed.push(id);
    });

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLButtonElement>('app-button button')?.click();

    expect(removed).toEqual(['a']);
  });

  it('render_whenBlankRow_offersNoRemoveButton', () => {
    render([]);

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelectorAll('app-button')).toHaveLength(0);
  });

  /**
   * Reads the identity the blank row is currently rendered under, which is the id the grid hands out
   * when that row is typed into.
   * @returns Returns the blank row's id.
   */
  function blankRowId(): string {
    const rows: readonly PropertyGridRow[] = (
      component as unknown as { displayRows: () => readonly PropertyGridRow[] }
    ).displayRows();
    return rows[rows.length - 1].id;
  }
});
