import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ColorSwatches, ColorSwatchOption } from './color-swatches';

const OPTIONS: readonly ColorSwatchOption[] = [
  { value: 'blue', color: 'var(--accent-blue)', label: 'blue' },
  { value: 'green', color: 'var(--accent-green)', label: 'green' },
];

describe('ColorSwatches', () => {
  let component: ColorSwatches;
  let fixture: ComponentFixture<ColorSwatches>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ColorSwatches],
    }).compileComponents();

    fixture = TestBed.createComponent(ColorSwatches);
    fixture.componentRef.setInput('options', OPTIONS);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_whenOptionsSet_rendersASwatchPerEntry', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelectorAll('.swatch').length).toBe(2);
  });

  it('render_whenOptionsSet_labelsEachSwatch', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.swatch[aria-label="green"]')).toBeTruthy();
  });

  it('render_whenValueSet_marksTheSelectedSwatch', async () => {
    fixture.componentRef.setInput('value', 'green');
    fixture.detectChanges();
    await fixture.whenStable();

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const selected: Element | null = element.querySelector('.swatch--selected');
    expect(selected?.getAttribute('aria-label')).toBe('green');
    expect(selected?.getAttribute('aria-checked')).toBe('true');
  });

  it('valueChange_whenSwatchClicked_emitsThePickedValue', () => {
    let emitted: string | undefined;
    component.valueChange.subscribe((value: string): void => {
      emitted = value;
    });

    const swatch: HTMLButtonElement = (fixture.nativeElement as HTMLElement).querySelector(
      '.swatch[aria-label="green"]',
    )!;
    swatch.click();

    expect(emitted).toBe('green');
  });
});
