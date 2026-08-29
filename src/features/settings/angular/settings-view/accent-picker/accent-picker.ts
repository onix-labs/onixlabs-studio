import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  Signal,
} from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { Slider } from '@shared/angular/components/forms/slider/slider';
import {
  clampSaturation,
  hexToHsl,
  MAX_SATURATION,
  MIN_SATURATION,
  normaliseHue,
} from '@shared/angular/services/theme/accent-color';
import {
  Accent,
  ACCENT_PRESETS,
  AccentPreset,
  resolveAccent,
} from '@shared/angular/services/theme/theme';

/**
 * Identifies the Custom entry in the accent dropdown, distinct from any preset id.
 */
const CUSTOM_VALUE: string = 'custom';

/**
 * A rainbow chip shown beside the Custom entry when no custom colour is in effect, signalling that it
 * opens the freeform hue/saturation controls.
 */
const CUSTOM_CHIP: string =
  'conic-gradient(hsl(0 90% 55%), hsl(60 90% 55%), hsl(120 90% 55%), ' +
  'hsl(180 90% 55%), hsl(240 90% 55%), hsl(300 90% 55%), hsl(360 90% 55%))';

/**
 * Renders and edits the accent choice: a dropdown of curated presets plus a Custom entry that reveals
 * hue and saturation sliders. Lightness is not exposed — a custom accent is built at a fixed lightness
 * so it stays legible in both themes — and saturation is clamped away from grey. The control is
 * controlled: it displays whatever {@link value} supplies and reports picks through
 * {@link valueChange}.
 */
@Component({
  selector: 'app-accent-picker',
  imports: [Dropdown, Slider],
  templateUrl: './accent-picker.html',
  styleUrl: './accent-picker.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccentPicker {
  /**
   * Gets the current accent choice.
   */
  public readonly value: InputSignal<Accent> = input.required<Accent>();

  /**
   * Emits the newly chosen accent when the selection changes.
   */
  public readonly valueChange: OutputEmitterRef<Accent> = output<Accent>();

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets the lowest selectable saturation.
   */
  protected readonly minSaturation: number = MIN_SATURATION;

  /**
   * Gets the highest selectable saturation.
   */
  protected readonly maxSaturation: number = MAX_SATURATION;

  /**
   * Gets a value indicating whether the custom hue/saturation controls are active.
   */
  protected readonly isCustom: Signal<boolean> = computed(
    (): boolean => this.value().kind === 'custom',
  );

  /**
   * Gets the resolved hex colour of the current accent, for the Custom chip when a custom colour is in
   * effect.
   */
  protected readonly previewColor: Signal<string> = computed(
    (): string => resolveAccent(this.value()).hex,
  );

  /**
   * Gets the dropdown options: a colour chip per preset, plus the trailing Custom entry (which shows
   * the current custom colour once one is chosen, and the rainbow chip otherwise).
   */
  protected readonly options: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] => [
      ...ACCENT_PRESETS.map((preset: AccentPreset): DropdownOption => ({
        value: preset.id,
        label: preset.label,
        color: preset.hex,
      })),
      {
        value: CUSTOM_VALUE,
        label: 'Custom',
        color: this.isCustom() ? this.previewColor() : CUSTOM_CHIP,
      },
    ],
  );

  /**
   * Gets the value shown as selected in the dropdown: the preset id, or the Custom sentinel.
   */
  protected readonly selectedValue: Signal<string> = computed((): string => {
    const accent: Accent = this.value();
    return accent.kind === 'custom' ? CUSTOM_VALUE : accent.id;
  });

  /**
   * Gets the hue driving the custom controls. It comes from the custom accent when one is active, and
   * otherwise from the current preset's colour, so switching to Custom starts from where the accent
   * already is rather than jumping.
   */
  protected readonly hue: Signal<number> = computed((): number => {
    const accent: Accent = this.value();
    return accent.kind === 'custom' ? accent.hue : hexToHsl(resolveAccent(accent).hex).hue;
  });

  /**
   * Gets the saturation driving the custom controls, sourced like {@link hue} and clamped away from
   * grey.
   */
  protected readonly saturation: Signal<number> = computed((): number => {
    const accent: Accent = this.value();
    const raw: number =
      accent.kind === 'custom' ? accent.saturation : hexToHsl(resolveAccent(accent).hex).saturation;
    return clampSaturation(raw);
  });

  /**
   * Gets the CSS gradient painted on the hue slider's track: the full spectrum at full saturation.
   */
  protected readonly hueTrack: string =
    'linear-gradient(to right, ' +
    'hsl(0 100% 50%), hsl(60 100% 50%), hsl(120 100% 50%), ' +
    'hsl(180 100% 50%), hsl(240 100% 50%), hsl(300 100% 50%), hsl(360 100% 50%))';

  /**
   * Gets the CSS gradient painted on the saturation slider's track: from the lowest permitted
   * saturation to full saturation, at the current hue.
   */
  protected readonly saturationTrack: Signal<string> = computed((): string => {
    const hue: number = this.hue();
    return `linear-gradient(to right, hsl(${hue} ${MIN_SATURATION}% 50%), hsl(${hue} 100% 50%))`;
  });

  /**
   * Applies a dropdown selection: a preset id, or the Custom entry (seeded from the accent currently
   * in effect so the sliders begin where the previous colour left off).
   * @param value The selected dropdown value.
   */
  protected onSelect(value: string): void {
    if (value === CUSTOM_VALUE) {
      if (this.value().kind === 'custom') {
        return;
      }
      this.log.info('settings.accent', 'Custom accent selected');
      this.valueChange.emit({ kind: 'custom', hue: this.hue(), saturation: this.saturation() });
      return;
    }
    this.log.info('settings.accent', 'Accent preset selected', value);
    this.valueChange.emit({ kind: 'preset', id: value });
  }

  /**
   * Applies a new hue from the hue slider.
   * @param hue The hue in degrees.
   */
  protected onHue(hue: number): void {
    this.log.debug('settings.accent', 'Custom accent hue changed', normaliseHue(hue));
    this.valueChange.emit({
      kind: 'custom',
      hue: normaliseHue(hue),
      saturation: this.saturation(),
    });
  }

  /**
   * Applies a new saturation from the saturation slider.
   * @param saturation The saturation as a percentage.
   */
  protected onSaturation(saturation: number): void {
    this.log.debug(
      'settings.accent',
      'Custom accent saturation changed',
      clampSaturation(saturation),
    );
    this.valueChange.emit({
      kind: 'custom',
      hue: this.hue(),
      saturation: clampSaturation(saturation),
    });
  }
}
