import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AccentPicker } from './accent-picker';
import { Accent, ACCENT_PRESETS } from '@shared/angular/services/theme/theme';

describe('AccentPicker', () => {
  let component: AccentPicker;
  let fixture: ComponentFixture<AccentPicker>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AccentPicker],
    }).compileComponents();

    fixture = TestBed.createComponent(AccentPicker);
    component = fixture.componentInstance;
  });

  /**
   * Renders the picker with the given accent value.
   * @param value The accent to bind.
   * @returns Returns the rendered host element.
   */
  async function render(value: Accent): Promise<HTMLElement> {
    fixture.componentRef.setInput('value', value);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  /**
   * Gets the accent dropdown's underlying native select.
   * @param element The host element.
   * @returns Returns the select element.
   */
  function select(element: HTMLElement): HTMLSelectElement {
    return element.querySelector<HTMLSelectElement>('app-dropdown select')!;
  }

  it('should create', async () => {
    await render({ kind: 'preset', id: 'blue' });
    expect(component).toBeTruthy();
  });

  it('render_whenPresetValue_selectsThatPresetAndHidesTheSliders', async () => {
    const element: HTMLElement = await render({ kind: 'preset', id: 'blue' });

    // One option per preset, plus the trailing Custom entry.
    expect(element.querySelectorAll('app-dropdown option').length).toBe(ACCENT_PRESETS.length + 1);
    expect(select(element).value).toBe('blue');
    expect(element.querySelector('app-slider')).toBeNull();
  });

  it('render_whenCustomValue_selectsCustomAndShowsTheSliders', async () => {
    const element: HTMLElement = await render({ kind: 'custom', hue: 200, saturation: 60 });

    expect(select(element).value).toBe('custom');
    expect(element.querySelectorAll('app-slider').length).toBe(2);
  });

  it('valueChange_whenPresetPicked_emitsThatPreset', async () => {
    const element: HTMLElement = await render({ kind: 'preset', id: 'blue' });
    let emitted: Accent | undefined;
    component.valueChange.subscribe((value: Accent): void => {
      emitted = value;
    });

    const dropdown: HTMLSelectElement = select(element);
    dropdown.value = 'green';
    dropdown.dispatchEvent(new Event('change'));

    expect(emitted).toEqual({ kind: 'preset', id: 'green' });
  });

  it('valueChange_whenCustomPickedFromPreset_seedsCustomFromTheCurrentColour', async () => {
    const element: HTMLElement = await render({ kind: 'preset', id: 'blue' });
    let emitted: Accent | undefined;
    component.valueChange.subscribe((value: Accent): void => {
      emitted = value;
    });

    const dropdown: HTMLSelectElement = select(element);
    dropdown.value = 'custom';
    dropdown.dispatchEvent(new Event('change'));

    expect(emitted?.kind).toBe('custom');
    // Blue (#0D6EFD) is a high-saturation azure hue, so the seed lands in the blue range.
    expect((emitted as { hue: number }).hue).toBeGreaterThan(180);
    expect((emitted as { hue: number }).hue).toBeLessThan(260);
  });

  it('valueChange_whenHueSliderMoves_emitsCustomWithTheNewHue', async () => {
    const element: HTMLElement = await render({ kind: 'custom', hue: 100, saturation: 50 });
    let emitted: Accent | undefined;
    component.valueChange.subscribe((value: Accent): void => {
      emitted = value;
    });

    const hueInput: HTMLInputElement =
      element.querySelectorAll<HTMLInputElement>('app-slider input')[0];
    hueInput.value = '300';
    hueInput.dispatchEvent(new Event('input'));

    expect(emitted).toEqual({ kind: 'custom', hue: 300, saturation: 50 });
  });

  it('valueChange_whenSaturationSliderMoves_clampsAwayFromGrey', async () => {
    const element: HTMLElement = await render({ kind: 'custom', hue: 100, saturation: 50 });
    let emitted: Accent | undefined;
    component.valueChange.subscribe((value: Accent): void => {
      emitted = value;
    });

    const satInput: HTMLInputElement =
      element.querySelectorAll<HTMLInputElement>('app-slider input')[1];
    satInput.value = '0';
    satInput.dispatchEvent(new Event('input'));

    expect(emitted).toEqual({ kind: 'custom', hue: 100, saturation: 12 });
  });
});
