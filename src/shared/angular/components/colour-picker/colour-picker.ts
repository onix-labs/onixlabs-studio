import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  InputSignal,
  linkedSignal,
  output,
  OutputEmitterRef,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { Button } from '@shared/angular/components/forms/button/button';
import {
  ButtonGroup,
  ButtonGroupOption,
} from '@shared/angular/components/forms/button-group/button-group';
import { NumberField } from '@shared/angular/components/forms/number-field/number-field';
import { Slider } from '@shared/angular/components/forms/slider/slider';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import {
  ColourFamily,
  ColourFormat,
  cssColour,
  formatColour,
  formatForFamily,
  hexColour,
  Hsla,
  hslToHsv,
  Hsva,
  hsvToHsl,
  hsvToRgb,
  normaliseHue,
  parseColour,
  ParsedColour,
  Rgba,
  rgbToHsv,
} from '@shared/angular/services/colour-picker/colours';

/**
 * Names the ways the picker picks a colour: the colour wheel, HSL sliders, RGB sliders, or a hex code.
 */
export type PickMode = 'wheel' | 'hsl' | 'rgb' | 'hex';

/**
 * Names one channel the picker's sliders and fields set.
 */
export type ColourChannel =
  'hue' | 'saturation' | 'lightness' | 'value' | 'red' | 'green' | 'blue' | 'alpha';

/**
 * What the picker hands back when a colour is applied.
 */
export interface ColourChoice {
  /**
   * Gets the colour picked.
   */
  readonly colour: Rgba;

  /**
   * Gets the format to write it in, or null when the colour's language writes it (its provider).
   */
  readonly format: ColourFormat | null;
}

/**
 * One row of the picker: a channel's label, its slider and its number field.
 */
export interface ChannelRow {
  /**
   * Gets the channel the row sets.
   */
  readonly channel: ColourChannel;

  /**
   * Gets the row's label.
   */
  readonly label: string;

  /**
   * Gets the channel's largest value.
   */
  readonly max: number;

  /**
   * Gets the channel's value, rounded as the row shows it.
   */
  readonly value: number;

  /**
   * Gets the CSS background the slider's track paints: the colour at every value of the channel.
   */
  readonly track: string;
}

/**
 * Holds the pick modes the picker offers, in order.
 */
const MODES: readonly ButtonGroupOption[] = [
  { value: 'wheel', label: 'Wheel' },
  { value: 'hsl', label: 'HSL' },
  { value: 'rgb', label: 'RGB' },
  { value: 'hex', label: 'Hex' },
];

/**
 * Holds the formats the format switcher writes a colour in, in order.
 */
const FAMILIES: readonly ButtonGroupOption[] = [
  { value: 'hex', label: 'Hex' },
  { value: 'rgb', label: 'RGB' },
  { value: 'hsl', label: 'HSL' },
];

/**
 * Holds the full hue spectrum, as a gradient across a track.
 */
const HUE_TRACK: string =
  'linear-gradient(to right, hsl(0 100% 50%), hsl(60 100% 50%), hsl(120 100% 50%), ' +
  'hsl(180 100% 50%), hsl(240 100% 50%), hsl(300 100% 50%), hsl(360 100% 50%))';

/**
 * Holds the checkerboard drawn behind a colour that is not opaque, as a background layer.
 */
export const CHECKERBOARD: string =
  'repeating-conic-gradient(#c8c8c8 0% 25%, #ffffff 0% 50%) 0 0 / 0.5rem 0.5rem';

/**
 * Draws Studio's colour picker (#1025), in place of Monaco's: opened by a click on a colour swatch in
 * the editor, it picks a colour with a colour wheel (hue round it, saturation out from its centre,
 * brightness beside it), HSL sliders, RGB sliders or a hex code — the mode switchable — each with an
 * alpha slider. It shows the colour as written beside the new one, and the text the new one will be
 * written as; the format switcher writes it as hex, `rgb()` or `hsl()` instead of the way it was
 * written.
 *
 * Nothing is written while picking: the preview is the picker's own. **Apply** or Enter hands the
 * colour back once, as one edit; **Cancel** or Escape hands back nothing. Shown by the
 * {@link import('@shared/angular/services/colour-picker/colour-pickers').ColourPickers} in a CDK
 * overlay of the editor's window; it only says what was chosen.
 *
 * Every control is reachable with Tab; the wheel takes the arrow keys (← → the hue, ↑ ↓ the
 * saturation, with Shift for bigger steps).
 */
@Component({
  selector: 'app-colour-picker',
  imports: [Button, ButtonGroup, NumberField, Slider, TextField],
  templateUrl: './colour-picker.html',
  styleUrl: './colour-picker.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'dialog',
    'aria-label': 'Colour picker',
    '(keydown)': 'onKeydown($event)',
  },
})
export class ColourPicker {
  /**
   * Gets the colour as written, which the picker starts from.
   */
  public readonly colour: InputSignal<Rgba> = input.required<Rgba>();

  /**
   * Gets how the colour was written, or null when the picker cannot read the text and the colour's
   * language writes the new one: then there is no format switcher and no text preview.
   */
  public readonly format: InputSignal<ColourFormat | null> = input<ColourFormat | null>(null);

  /**
   * Gets the pick mode the picker opens in.
   */
  public readonly mode: InputSignal<PickMode> = input<PickMode>('wheel');

  /**
   * Raised with the colour, and the format to write it in, when it is applied.
   */
  public readonly applied: OutputEmitterRef<ColourChoice> = output<ColourChoice>();

  /**
   * Raised when the pick is cancelled.
   */
  public readonly cancelled: OutputEmitterRef<void> = output<void>();

  /**
   * Raised with the pick mode when another is chosen, so the next picker opens in it.
   */
  public readonly modeChange: OutputEmitterRef<PickMode> = output<PickMode>();

  /**
   * Gets the pick modes, exposed for the template.
   */
  protected readonly modes: readonly ButtonGroupOption[] = MODES;

  /**
   * Gets the formats the switcher offers, exposed for the template.
   */
  protected readonly families: readonly ButtonGroupOption[] = FAMILIES;

  /**
   * Holds the picker's element, whose first control takes the keyboard as it opens.
   */
  private readonly host: ElementRef<HTMLElement> = inject<ElementRef<HTMLElement>>(ElementRef);

  /**
   * Holds the colour being picked, as hue, saturation and value: kept so, rather than as channels, so
   * a hue survives the colour passing through grey.
   */
  protected readonly hsva: WritableSignal<Hsva> = linkedSignal<Hsva>((): Hsva =>
    rgbToHsv(this.colour()),
  );

  /**
   * Holds the pick mode showing.
   */
  protected readonly pickMode: WritableSignal<PickMode> = linkedSignal<PickMode>((): PickMode =>
    this.mode(),
  );

  /**
   * Holds the format family the colour will be written in: the one it was written in until the
   * switcher picks another.
   */
  protected readonly family: WritableSignal<ColourFamily> = linkedSignal<ColourFamily>(
    (): ColourFamily => this.format()?.family ?? 'hex',
  );

  /**
   * Holds the hex field's text while it is being typed in, so a code typed part-way is not rewritten
   * under the caret; null when the field shows the colour.
   */
  protected readonly hexDraft: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds whether the wheel is being dragged.
   */
  private dragging: boolean = false;

  /**
   * Gets the colour being picked as channels.
   */
  protected readonly rgb: Signal<Rgba> = computed((): Rgba => hsvToRgb(this.hsva()));

  /**
   * Gets the colour being picked as hue, saturation and lightness.
   */
  protected readonly hsl: Signal<Hsla> = computed((): Hsla => hsvToHsl(this.hsva()));

  /**
   * Gets the colour as written, as CSS, for the "before" swatch.
   */
  protected readonly originalCss: Signal<string> = computed((): string => cssColour(this.colour()));

  /**
   * Gets the colour being picked, as CSS, for the "after" swatch.
   */
  protected readonly currentCss: Signal<string> = computed((): string => cssColour(this.rgb()));

  /**
   * Gets the colour being picked, opaque, as CSS: what the wheel's thumb shows.
   */
  protected readonly opaqueCss: Signal<string> = computed((): string =>
    cssColour({ ...this.rgb(), alpha: 1 }),
  );

  /**
   * Gets the format the colour will be written in, or null when its language writes it.
   */
  protected readonly writtenFormat: Signal<ColourFormat | null> = computed(
    (): ColourFormat | null => {
      const written: ColourFormat | null = this.format();
      return written === null ? null : formatForFamily(this.family(), written);
    },
  );

  /**
   * Gets the text the colour being picked will be written as, or null when its language writes it.
   */
  protected readonly previewText: Signal<string | null> = computed((): string | null => {
    const format: ColourFormat | null = this.writtenFormat();
    return format === null ? null : formatColour(this.rgb(), format);
  });

  /**
   * Gets the hex field's text: what is being typed, or the colour as `#rrggbb` (`#rrggbbaa` when it is
   * not opaque).
   */
  protected readonly hexText: Signal<string> = computed(
    (): string => this.hexDraft() ?? hexColour(this.rgb()),
  );

  /**
   * Gets where the wheel's thumb stands across the wheel, as a percentage of its width.
   */
  protected readonly thumbX: Signal<number> = computed((): number => {
    const { hue, saturation } = this.hsva();
    return 50 + (saturation / 2) * Math.sin((hue * Math.PI) / 180);
  });

  /**
   * Gets where the wheel's thumb stands down the wheel, as a percentage of its height.
   */
  protected readonly thumbY: Signal<number> = computed((): number => {
    const { hue, saturation } = this.hsva();
    return 50 - (saturation / 2) * Math.cos((hue * Math.PI) / 180);
  });

  /**
   * Gets how dark the wheel is drawn: the brightness's shortfall, as the opacity of a black veil.
   */
  protected readonly wheelShade: Signal<number> = computed(
    (): number => 1 - this.hsva().value / 100,
  );

  /**
   * Gets the wheel's hue, rounded, as its value for a screen reader.
   */
  protected readonly wheelHue: Signal<number> = computed((): number => Math.round(this.hsva().hue));

  /**
   * Gets what the wheel says of itself to a screen reader.
   */
  protected readonly wheelText: Signal<string> = computed((): string => {
    const { hue, saturation } = this.hsva();
    return `Hue ${Math.round(hue)}°, saturation ${Math.round(saturation)}%`;
  });

  /**
   * Gets the rows the current mode shows: the wheel's brightness, the HSL sliders or the RGB sliders;
   * none for the hex code.
   */
  protected readonly rows: Signal<readonly ChannelRow[]> = computed((): readonly ChannelRow[] => {
    switch (this.pickMode()) {
      case 'wheel':
        return [this.valueRow()];
      case 'hsl':
        return this.hslRows();
      case 'rgb':
        return this.rgbRows();
      default:
        return [];
    }
  });

  /**
   * Gets the alpha row, which every mode shows.
   */
  protected readonly alphaRow: Signal<ChannelRow> = computed((): ChannelRow => {
    const { red, green, blue } = this.rgb();
    const solid: string = `${Math.round(red)} ${Math.round(green)} ${Math.round(blue)}`;
    return {
      channel: 'alpha',
      label: 'Alpha',
      max: 100,
      value: Math.round(this.hsva().alpha * 100),
      track: `linear-gradient(to right, rgb(${solid} / 0), rgb(${solid} / 1)), ${CHECKERBOARD}`,
    };
  });

  /**
   * Initializes a new instance of the {@link ColourPicker} class, giving the first control of the mode
   * the keyboard once it is drawn.
   */
  public constructor() {
    afterNextRender((): void => this.focusFirstControl());
  }

  /**
   * Sets one channel of the colour being picked, from its slider or its number field.
   * @param channel The channel.
   * @param value The channel's new value, on its row's scale.
   */
  public setChannel(channel: ColourChannel, value: number): void {
    const current: Hsva = this.hsva();
    this.hexDraft.set(null);
    switch (channel) {
      case 'hue':
        this.hsva.set({ ...current, hue: normaliseHue(value) });
        return;
      case 'value':
        this.hsva.set({ ...current, value });
        return;
      case 'alpha':
        this.hsva.set({ ...current, alpha: value / 100 });
        return;
      case 'saturation':
      case 'lightness':
        this.hsva.set(hslToHsv({ ...this.hsl(), [channel]: value }));
        return;
      default:
        this.hsva.set(rgbToHsv({ ...this.rgb(), [channel]: value }, current.hue));
    }
  }

  /**
   * Applies the colour being picked: hands it back with the format it is to be written in.
   */
  public apply(): void {
    this.applied.emit({ colour: this.rgb(), format: this.writtenFormat() });
  }

  /**
   * Shows another pick mode.
   * @param mode The mode's value.
   */
  protected onMode(mode: string): void {
    this.pickMode.set(mode as PickMode);
    this.hexDraft.set(null);
    this.modeChange.emit(mode as PickMode);
  }

  /**
   * Picks the format family the colour is written in.
   * @param family The family's value.
   */
  protected onFamily(family: string): void {
    this.family.set(family as ColourFamily);
  }

  /**
   * Takes the hex field's text as it is typed: any colour it reads as — a hex code, a colour function
   * or a name — becomes the colour being picked, while the text stays as typed.
   * @param text The field's text.
   */
  protected onHex(text: string): void {
    this.hexDraft.set(text);
    const parsed: ParsedColour | null = parseColour(text);
    if (parsed !== null) {
      this.hsva.set(rgbToHsv(parsed.colour, this.hsva().hue));
    }
  }

  /**
   * Starts dragging the wheel's thumb to the pointer.
   * @param event The pointer going down on the wheel.
   */
  protected onWheelDown(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    const wheel: HTMLElement = event.currentTarget as HTMLElement;
    wheel.focus();
    wheel.setPointerCapture?.(event.pointerId);
    this.dragging = true;
    this.pickAt(wheel, event);
  }

  /**
   * Drags the wheel's thumb to the pointer.
   * @param event The pointer moving over the wheel.
   */
  protected onWheelMove(event: PointerEvent): void {
    if (this.dragging) {
      this.pickAt(event.currentTarget as HTMLElement, event);
    }
  }

  /**
   * Stops dragging the wheel's thumb.
   * @param event The pointer going up, or the drag cancelled.
   */
  protected onWheelUp(event: PointerEvent): void {
    this.dragging = false;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
  }

  /**
   * Moves the wheel's thumb with the arrow keys: ← → turn the hue, ↑ ↓ change the saturation; Shift
   * takes steps of ten.
   * @param event The key pressed on the wheel.
   */
  protected onWheelKey(event: KeyboardEvent): void {
    const step: number = event.shiftKey ? 10 : 1;
    const { hue, saturation } = this.hsva();
    const moves: Partial<Record<string, () => void>> = {
      ArrowLeft: (): void => this.setChannel('hue', hue - step),
      ArrowRight: (): void => this.setChannel('hue', hue + step),
      ArrowUp: (): void => this.setSaturation(saturation + step),
      ArrowDown: (): void => this.setSaturation(saturation - step),
    };
    const move: (() => void) | undefined = moves[event.key];
    if (move !== undefined) {
      event.preventDefault();
      move();
    }
  }

  /**
   * Answers Escape, which cancels, and Enter, which applies — except on a button, which Enter presses.
   * @param event The key pressed in the picker.
   */
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.cancelled.emit();
      return;
    }
    if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) {
      event.preventDefault();
      event.stopPropagation();
      this.apply();
    }
  }

  /**
   * Sets the wheel's saturation, as the hue-and-saturation wheel picks it.
   * @param saturation The saturation, 0–100; clamped.
   */
  private setSaturation(saturation: number): void {
    this.hexDraft.set(null);
    this.hsva.set({ ...this.hsva(), saturation: Math.min(100, Math.max(0, saturation)) });
  }

  /**
   * Picks the hue and saturation under the pointer on the wheel: the angle from the top, clockwise, is
   * the hue, and the distance from the centre the saturation.
   * @param wheel The wheel's element.
   * @param event The pointer.
   */
  private pickAt(wheel: HTMLElement, event: PointerEvent): void {
    const rect: DOMRect = wheel.getBoundingClientRect();
    const radius: number = rect.width / 2;
    if (radius <= 0) {
      return;
    }
    const x: number = event.clientX - (rect.left + radius);
    const y: number = event.clientY - (rect.top + rect.height / 2);
    const hue: number = normaliseHue((Math.atan2(x, -y) * 180) / Math.PI);
    this.hexDraft.set(null);
    this.hsva.set({
      ...this.hsva(),
      hue,
      saturation: Math.min(100, (Math.hypot(x, y) / radius) * 100),
    });
  }

  /**
   * Builds the wheel's brightness row.
   * @returns Returns the row.
   */
  private valueRow(): ChannelRow {
    const { hue, saturation, value } = this.hsva();
    const bright: string = cssColour(hsvToRgb({ hue, saturation, value: 100, alpha: 1 }));
    return {
      channel: 'value',
      label: 'Brightness',
      max: 100,
      value: Math.round(value),
      track: `linear-gradient(to right, #000000, ${bright})`,
    };
  }

  /**
   * Builds the HSL rows.
   * @returns Returns the rows.
   */
  private hslRows(): readonly ChannelRow[] {
    const { hue, saturation, lightness } = this.hsl();
    const h: number = Math.round(hue);
    const s: number = Math.round(saturation);
    return [
      { channel: 'hue', label: 'Hue', max: 360, value: h, track: HUE_TRACK },
      {
        channel: 'saturation',
        label: 'Saturation',
        max: 100,
        value: s,
        track: `linear-gradient(to right, hsl(${h} 0% ${lightness}%), hsl(${h} 100% ${lightness}%))`,
      },
      {
        channel: 'lightness',
        label: 'Lightness',
        max: 100,
        value: Math.round(lightness),
        track: `linear-gradient(to right, #000000, hsl(${h} ${s}% 50%), #ffffff)`,
      },
    ];
  }

  /**
   * Builds the RGB rows.
   * @returns Returns the rows.
   */
  private rgbRows(): readonly ChannelRow[] {
    const { red, green, blue } = this.rgb();
    const [r, g, b] = [red, green, blue].map(Math.round);
    return [
      {
        channel: 'red',
        label: 'Red',
        max: 255,
        value: r,
        track: `linear-gradient(to right, rgb(0 ${g} ${b}), rgb(255 ${g} ${b}))`,
      },
      {
        channel: 'green',
        label: 'Green',
        max: 255,
        value: g,
        track: `linear-gradient(to right, rgb(${r} 0 ${b}), rgb(${r} 255 ${b}))`,
      },
      {
        channel: 'blue',
        label: 'Blue',
        max: 255,
        value: b,
        track: `linear-gradient(to right, rgb(${r} ${g} 0), rgb(${r} ${g} 255))`,
      },
    ];
  }

  /**
   * Gives the first control of the mode showing the keyboard: the wheel, the first slider, or the hex
   * field.
   */
  private focusFirstControl(): void {
    this.host.nativeElement
      .querySelector<HTMLElement>('.colour-picker__body input, .colour-picker__body [tabindex="0"]')
      ?.focus();
  }
}
