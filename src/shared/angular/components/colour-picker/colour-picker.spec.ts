import { ComponentFixture, TestBed } from '@angular/core/testing';
import { parseColour, ParsedColour, Rgba } from '@shared/angular/services/colour-picker/colours';
import { ColourChoice, ColourPicker, PickMode } from './colour-picker';

/**
 * Reads a colour that must read.
 * @param text The text.
 * @returns Returns the colour and its format.
 */
function parsed(text: string): ParsedColour {
  return parseColour(text)!;
}

describe('ColourPicker (#1025)', () => {
  let fixture: ComponentFixture<ColourPicker>;
  let applied: ColourChoice[];
  let cancelled: number;
  let modes: PickMode[];

  /**
   * Renders the picker for a colour as written.
   * @param text The colour's text, or null for a colour Studio cannot read (red, its provider writing).
   * @param mode The mode it opens in.
   * @returns Returns the picker's element.
   */
  async function render(text: string | null, mode: PickMode = 'wheel'): Promise<HTMLElement> {
    const colour: ParsedColour | null = text === null ? null : parsed(text);
    fixture.componentRef.setInput(
      'colour',
      colour?.colour ?? ({ red: 255, green: 0, blue: 0, alpha: 1 } satisfies Rgba),
    );
    fixture.componentRef.setInput('format', colour?.format ?? null);
    fixture.componentRef.setInput('mode', mode);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  /**
   * Finds a button of the picker by its label.
   * @param element The picker's element.
   * @param label The label.
   * @returns Returns the button.
   */
  function button(element: HTMLElement, label: string): HTMLButtonElement {
    const found: HTMLButtonElement | undefined = [...element.querySelectorAll('button')].find(
      (candidate: HTMLButtonElement): boolean => candidate.textContent?.trim() === label,
    );
    if (found === undefined) {
      throw new Error(`No button ${label}`);
    }
    return found;
  }

  /**
   * Reads the text the colour will be written as.
   * @param element The picker's element.
   * @returns Returns the text, or null when none shows.
   */
  function preview(element: HTMLElement): string | null {
    return element.querySelector('.colour-picker__text')?.textContent?.trim() ?? null;
  }

  /**
   * Types a value into an input and raises its input event.
   * @param input The input.
   * @param value The value.
   */
  async function type(input: HTMLInputElement, value: string): Promise<void> {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
  }

  /**
   * Presses a key on an element.
   * @param target The element.
   * @param key The key.
   * @param shiftKey Whether Shift is held.
   */
  async function press(target: Element, key: string, shiftKey: boolean = false): Promise<void> {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }));
    await fixture.whenStable();
  }

  beforeEach(async () => {
    applied = [];
    cancelled = 0;
    modes = [];
    await TestBed.configureTestingModule({ imports: [ColourPicker] }).compileComponents();
    fixture = TestBed.createComponent(ColourPicker);
    fixture.componentInstance.applied.subscribe((choice: ColourChoice): void => {
      applied.push(choice);
    });
    fixture.componentInstance.cancelled.subscribe((): void => void (cancelled += 1));
    fixture.componentInstance.modeChange.subscribe((mode: PickMode): void => void modes.push(mode));
  });

  it('opensOnTheWheel_showingBothColours_andTheTextAsWritten', async () => {
    const element: HTMLElement = await render('#ff0000');

    const wheel: HTMLElement | null = element.querySelector('[role="slider"]');
    expect(wheel?.getAttribute('aria-label')).toBe('Hue and saturation');
    expect(wheel?.getAttribute('aria-valuetext')).toBe('Hue 0°, saturation 100%');
    expect(element.querySelectorAll('.colour-picker__swatch')).toHaveLength(2);
    expect(preview(element)).toBe('#ff0000');
    expect(
      element.querySelector<HTMLInputElement>('input[type="range"][aria-label="Brightness"]'),
    ).not.toBeNull();
    expect(
      element.querySelector<HTMLInputElement>('input[type="range"][aria-label="Alpha"]'),
    ).not.toBeNull();
  });

  it('theWheel_takesTheArrowKeys_forHueAndSaturation', async () => {
    const element: HTMLElement = await render('#ff0000');
    const wheel: HTMLElement = element.querySelector<HTMLElement>('[role="slider"]')!;

    await press(wheel, 'ArrowRight', true);
    await press(wheel, 'ArrowRight');
    expect(wheel.getAttribute('aria-valuenow')).toBe('11');
    await press(wheel, 'ArrowDown', true);
    expect(wheel.getAttribute('aria-valuetext')).toBe('Hue 11°, saturation 90%');
    await press(wheel, 'ArrowLeft', true);
    await press(wheel, 'ArrowLeft', true);
    expect(wheel.getAttribute('aria-valuenow')).toBe('351');
  });

  it('theRgbSliders_setAChannel_andTheTextKeepsItsFormat', async () => {
    const element: HTMLElement = await render('rgb(255, 0, 0)', 'rgb');

    const green: HTMLInputElement = element.querySelector<HTMLInputElement>(
      'input[type="number"][aria-label="Green"]',
    )!;
    await type(green, '128');
    expect(preview(element)).toBe('rgb(255, 128, 0)');
    const alpha: HTMLInputElement = element.querySelector<HTMLInputElement>(
      'input[type="range"][aria-label="Alpha"]',
    )!;
    await type(alpha, '50');
    expect(preview(element)).toBe('rgba(255, 128, 0, 0.5)');
  });

  it('theHslSliders_setAChannel', async () => {
    const element: HTMLElement = await render('hsl(0deg 100% 50%)', 'hsl');

    const hue: HTMLInputElement = element.querySelector<HTMLInputElement>(
      'input[type="range"][aria-label="Hue"]',
    )!;
    await type(hue, '120');
    const lightness: HTMLInputElement = element.querySelector<HTMLInputElement>(
      'input[type="number"][aria-label="Lightness"]',
    )!;
    await type(lightness, '25');
    expect(preview(element)).toBe('hsl(120deg 100% 25%)');
  });

  it('theHexField_takesAnyColourAsTyped_andLeavesTheTextAsTyped', async () => {
    const element: HTMLElement = await render('rgb(255 0 0)', 'hex');
    const field: HTMLInputElement =
      element.querySelector<HTMLInputElement>('input[aria-label="Hex"]')!;
    expect(field.value).toBe('#ff0000');

    await type(field, '#00f');
    expect(field.value).toBe('#00f');
    expect(preview(element)).toBe('rgb(0 0 255)');
    await type(field, '#00');
    expect(preview(element)).toBe('rgb(0 0 255)');
    await type(field, 'lime');
    expect(preview(element)).toBe('rgb(0 255 0)');
  });

  it('theFormatSwitcher_writesAnotherFamily_andBack', async () => {
    const element: HTMLElement = await render('#f00');

    button(element, 'RGB').click();
    await fixture.whenStable();
    expect(preview(element)).toBe('#f00');
    const writeAs: HTMLElement = element.querySelector<HTMLElement>('.colour-picker__format')!;
    button(writeAs, 'HSL').click();
    await fixture.whenStable();
    expect(preview(element)).toBe('hsl(0, 100%, 50%)');
    button(writeAs, 'Hex').click();
    await fixture.whenStable();
    expect(preview(element)).toBe('#f00');
    expect(modes).toEqual(['rgb']);
  });

  it('enterAndApply_handTheColourBack_withItsFormat', async () => {
    const element: HTMLElement = await render('#ff0000', 'hex');
    await type(element.querySelector<HTMLInputElement>('input[aria-label="Hex"]')!, '#00ff00');

    await press(element.querySelector<HTMLInputElement>('input[aria-label="Hex"]')!, 'Enter');
    button(element, 'Apply').click();

    expect(applied).toHaveLength(2);
    expect(applied[0].format?.family).toBe('hex');
    expect(Math.round(applied[0].colour.green)).toBe(255);
    expect(Math.round(applied[0].colour.red)).toBe(0);
  });

  it('escapeAndCancel_handBackNothing_andEnterOnAButtonPressesIt', async () => {
    const element: HTMLElement = await render('#ff0000');

    await press(element.querySelector<HTMLElement>('[role="slider"]')!, 'Escape');
    button(element, 'Cancel').click();
    await press(button(element, 'Cancel'), 'Enter');

    expect(cancelled).toBe(2);
    expect(applied).toEqual([]);
  });

  it('aColourStudioCannotRead_showsNoSwitcherOrText_andIsHandedBackForItsProvider', async () => {
    const element: HTMLElement = await render(null);

    expect(element.querySelector('.colour-picker__format')).toBeNull();
    expect(preview(element)).toBeNull();
    button(element, 'Apply').click();
    expect(applied).toEqual([{ colour: { red: 255, green: 0, blue: 0, alpha: 1 }, format: null }]);
  });
});
