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
