import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Slider } from './slider';

describe('Slider', () => {
  let component: Slider;
  let fixture: ComponentFixture<Slider>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Slider],
    }).compileComponents();

    fixture = TestBed.createComponent(Slider);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  /**
   * Gets the underlying range input.
   * @returns Returns the range input element.
   */
  function input(): HTMLInputElement {
    return (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('input')!;
  }

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_whenBoundsSet_reflectsThemOnTheInput', async () => {
    fixture.componentRef.setInput('min', 10);
    fixture.componentRef.setInput('max', 200);
    fixture.componentRef.setInput('step', 5);
    fixture.componentRef.setInput('value', 25);
    fixture.detectChanges();
    await fixture.whenStable();

    const range: HTMLInputElement = input();
    expect(range.min).toBe('10');
    expect(range.max).toBe('200');
    expect(range.step).toBe('5');
    expect(range.value).toBe('25');
  });

  it('render_whenTrackBackgroundSet_paintsTheTrackVariable', async () => {
    fixture.componentRef.setInput('trackBackground', 'linear-gradient(to right, red, blue)');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(input().style.getPropertyValue('--slider-track')).toContain('linear-gradient');
  });

  it('render_whenDisabled_disablesTheInput', async () => {
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(input().disabled).toBe(true);
  });

  it('ariaLabel_whenSet_namesTheInput', async () => {
    fixture.componentRef.setInput('ariaLabel', 'Hue');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(input().getAttribute('aria-label')).toBe('Hue');
  });

  it('valueChange_whenInput_emitsTheNumericValue', () => {
    let emitted: number | undefined;
    component.valueChange.subscribe((value: number): void => {
      emitted = value;
    });

    const range: HTMLInputElement = input();
    range.value = '42';
    range.dispatchEvent(new Event('input'));

    expect(emitted).toBe(42);
  });
});
