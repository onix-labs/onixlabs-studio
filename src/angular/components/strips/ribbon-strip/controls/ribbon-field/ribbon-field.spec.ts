import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RibbonField } from './ribbon-field';

describe('RibbonField', () => {
  let component: RibbonField;
  let fixture: ComponentFixture<RibbonField>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RibbonField],
    }).compileComponents();

    fixture = TestBed.createComponent(RibbonField);
    fixture.componentRef.setInput('label', 'Configuration');
    fixture.componentRef.setInput('options', ['Debug', 'Release']);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_whenOptionsSet_rendersAnOptionPerEntry', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelectorAll('option').length).toBe(2);
  });

  it('value_whenInputChangesAfterUserSelection_followsTheNewValue', async () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const select: HTMLSelectElement = element.querySelector<HTMLSelectElement>('select')!;
    fixture.componentRef.setInput('value', 'Debug');
    fixture.detectChanges();

    // The user picks an option (setting the native select's dirty value flag) and the parent adopts
    // it through the value input, as the markdown ribbon does after applying the chosen block type.
    select.value = 'Release';
    select.dispatchEvent(new Event('change'));
    fixture.componentRef.setInput('value', 'Release');
    fixture.detectChanges();

    // The parent then moves the selection elsewhere; the field must follow rather than stay stuck.
    fixture.componentRef.setInput('value', 'Debug');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(select.value).toBe('Debug');
  });

  it('onChange_whenPickNotAdoptedByParent_reassertsTheBoundValue', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const select: HTMLSelectElement = element.querySelector<HTMLSelectElement>('select')!;
    fixture.componentRef.setInput('value', 'Debug');
    fixture.detectChanges();

    // The parent ignores the pick (value input unchanged); the select must snap back to it.
    select.value = 'Release';
    select.dispatchEvent(new Event('change'));

    expect(select.value).toBe('Debug');
  });

  it('changed_whenSelectionChanged_emitsTheNewValue', () => {
    let emitted: string | undefined;
    component.changed.subscribe((value: string): void => {
      emitted = value;
    });

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const select: HTMLSelectElement | null = element.querySelector<HTMLSelectElement>('select');
    if (select !== null) {
      select.value = 'Release';
      select.dispatchEvent(new Event('change'));
    }

    expect(emitted).toBe('Release');
  });
});
