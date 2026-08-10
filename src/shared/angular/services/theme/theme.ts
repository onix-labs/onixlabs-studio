import {
  computed,
  DOCUMENT,
  effect,
  inject,
  Service,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { SettingsStore } from '../settings-store/settings-store';
import {
  clampSaturation,
  CUSTOM_LIGHTNESS,
  hexToRgb,
  hslToRgb,
  normaliseHue,
  rgbToHex,
  rgbToTriplet,
} from './accent-color';

/**
 * Identifies the theme mode the user can choose. `system` follows the operating system preference.
 */
export type ThemeMode = 'light' | 'dark' | 'system';

/**
 * Identifies the effective theme actually applied to the document, after resolving `system`.
 */
export type ResolvedThemeMode = 'light' | 'dark';

/**
 * Describes a named accent preset: a curated colour offered as a one-click choice in the accent
 * picker, alongside the custom hue/saturation controls.
 */
export interface AccentPreset {
  /**
   * Gets the stable identifier persisted when the preset is chosen.
   */
  readonly id: string;

  /**
   * Gets the label shown for the preset.
   */
  readonly label: string;

  /**
   * Gets the exact hex colour the preset applies.
   */
  readonly hex: string;
}

/**
 * Lists the accent presets in picker order. These are curated exact colours; the custom option lets a
 * user pick any hue and saturation instead (see {@link CustomAccent}).
 */
export const ACCENT_PRESETS: readonly AccentPreset[] = [
  { id: 'yellow', label: 'Yellow', hex: '#F79533' },
  { id: 'orange', label: 'Orange', hex: '#F37055' },
  { id: 'red', label: 'Red', hex: '#DC3545' },
  { id: 'pink', label: 'Pink', hex: '#EF4E7B' },
  { id: 'purple', label: 'Purple', hex: '#7252AA' },
  { id: 'blue', label: 'Blue', hex: '#0D6EFD' },
  { id: 'cyan', label: 'Cyan', hex: '#1098AD' },
  { id: 'teal', label: 'Teal', hex: '#07B39B' },
  { id: 'green', label: 'Green', hex: '#6FBA82' },
];

/**
 * Selects one of the curated {@link ACCENT_PRESETS} by its identifier.
 */
export interface PresetAccent {
  /**
   * Gets the discriminator identifying a preset accent.
   */
  readonly kind: 'preset';

  /**
   * Gets the identifier of the chosen preset.
   */
  readonly id: string;
}

/**
 * Selects a freely chosen accent by hue and saturation. Lightness is fixed (see
 * {@link CUSTOM_LIGHTNESS}) so the colour stays legible in both themes.
 */
export interface CustomAccent {
  /**
   * Gets the discriminator identifying a custom accent.
   */
  readonly kind: 'custom';

  /**
   * Gets the hue in degrees (0–360).
   */
  readonly hue: number;

  /**
   * Gets the saturation as a percentage, clamped away from grey (see
   * {@link import('./accent-color').MIN_SATURATION}).
   */
  readonly saturation: number;
}

/**
 * Represents the chosen accent: either a curated preset or a custom hue/saturation.
 */
export type Accent = PresetAccent | CustomAccent;

/**
 * Holds the settings key under which the theme mode is persisted.
 */
const MODE_KEY: string = 'theme.mode';

/**
 * Holds the settings key under which the accent choice is persisted.
 */
const ACCENT_KEY: string = 'theme.accent';

/**
 * Holds the theme mode applied when no preference has been persisted.
 */
const DEFAULT_MODE: ThemeMode = 'system';

/**
 * Holds the accent applied when no preference has been persisted (or a persisted value cannot be
 * understood).
 */
const DEFAULT_ACCENT: Accent = { kind: 'preset', id: 'blue' };

/**
 * Coerces an arbitrary persisted value into a valid {@link Accent}, falling back to the default when
 * it cannot be understood. This also migrates the legacy format, where the accent was persisted as a
 * bare colour-name string (for example `"green"`): a name matching a current preset is kept, and any
 * other legacy name falls back to the default.
 * @param value The persisted value.
 * @returns Returns a valid accent.
 */
export function normaliseAccent(value: unknown): Accent {
  if (typeof value === 'string') {
    return isPresetId(value) ? { kind: 'preset', id: value } : DEFAULT_ACCENT;
  }
  if (typeof value !== 'object' || value === null) {
    return DEFAULT_ACCENT;
  }
  const candidate: Record<string, unknown> = value as Record<string, unknown>;
  if (
    candidate['kind'] === 'preset' &&
    typeof candidate['id'] === 'string' &&
    isPresetId(candidate['id'])
  ) {
    return { kind: 'preset', id: candidate['id'] };
  }
  if (
    candidate['kind'] === 'custom' &&
    typeof candidate['hue'] === 'number' &&
    typeof candidate['saturation'] === 'number'
  ) {
    return {
      kind: 'custom',
      hue: normaliseHue(candidate['hue']),
      saturation: clampSaturation(candidate['saturation']),
    };
  }
  return DEFAULT_ACCENT;
}

/**
 * Determines whether an identifier names a current accent preset.
 * @param id The candidate identifier.
 * @returns Returns true when a preset with the identifier exists.
 */
function isPresetId(id: string): boolean {
  return ACCENT_PRESETS.some((preset: AccentPreset): boolean => preset.id === id);
}

/**
 * Resolves an accent to the concrete hex colour and bare RGB triplet the document consumes. A preset
 * resolves to its exact hex; a custom accent is built from its hue and saturation at the fixed
 * lightness.
 * @param accent The chosen accent.
 * @returns Returns the hex colour and `r, g, b` triplet.
 */
export function resolveAccent(accent: Accent): { readonly hex: string; readonly rgb: string } {
  if (accent.kind === 'preset') {
    const preset: AccentPreset =
      ACCENT_PRESETS.find((entry: AccentPreset): boolean => entry.id === accent.id) ??
      ACCENT_PRESETS[0];
    return { hex: preset.hex, rgb: rgbToTriplet(hexToRgb(preset.hex)) };
  }
  const rgb: { r: number; g: number; b: number } = hslToRgb({
    hue: accent.hue,
    saturation: clampSaturation(accent.saturation),
    lightness: CUSTOM_LIGHTNESS,
  });
  return { hex: rgbToHex(rgb), rgb: rgbToTriplet(rgb) };
}

/**
 * Represents the source of truth for the application's theme mode and accent colour.
 *
 * Choices are restored from the {@link SettingsStore} on construction, exposed as signals, and
 * applied to the document root by an effect: the resolved light/dark mode drives the
 * `data-theme-mode` attribute that the SCSS theme switches on, and the accent is resolved to a hex
 * colour and RGB triplet projected onto the `--accent-color` custom properties. `system` mode is
 * resolved through `matchMedia` and tracks live operating-system changes.
 */
@Service()
export class Theme {
  /**
   * Holds the settings store used to persist and restore choices.
   */
  private readonly settings: SettingsStore = inject(SettingsStore);

  /**
   * Holds the document the theme is applied to.
   */
  private readonly document: Document = inject(DOCUMENT);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the chosen theme mode.
   */
  private readonly modeSignal: WritableSignal<ThemeMode> = signal<ThemeMode>(
    this.settings.get<ThemeMode>(MODE_KEY, DEFAULT_MODE),
  );

  /**
   * Holds the chosen accent.
   */
  private readonly accentSignal: WritableSignal<Accent> = signal<Accent>(
    normaliseAccent(this.settings.get<unknown>(ACCENT_KEY, DEFAULT_ACCENT)),
  );

  /**
   * Holds a value indicating whether the operating system currently prefers a dark colour scheme.
   */
  private readonly systemPrefersDark: WritableSignal<boolean> = signal<boolean>(
    this.prefersDarkQuery()?.matches ?? false,
  );

  /**
   * Gets the chosen theme mode.
   */
  public readonly mode: Signal<ThemeMode> = this.modeSignal.asReadonly();

  /**
   * Gets the chosen accent.
   */
  public readonly accent: Signal<Accent> = this.accentSignal.asReadonly();

  /**
   * Gets the resolved hex colour of the chosen accent, for consumers that need the concrete colour
   * rather than the `--accent-color` custom property (for example the terminal's canvas theme).
   */
  public readonly accentHex: Signal<string> = computed(
    (): string => resolveAccent(this.accentSignal()).hex,
  );

  /**
   * Gets the resolved bare `r, g, b` triplet of the chosen accent, for `rgba(...)` overlays outside
   * the DOM (for example the terminal's selection colour).
   */
  public readonly accentRgb: Signal<string> = computed(
    (): string => resolveAccent(this.accentSignal()).rgb,
  );

  /**
   * Gets the effective theme mode actually applied to the document, resolving `system` against the
   * operating-system preference.
   */
  public readonly resolvedMode: Signal<ResolvedThemeMode> = computed((): ResolvedThemeMode => {
    const mode: ThemeMode = this.modeSignal();
    if (mode === 'system') {
      return this.systemPrefersDark() ? 'dark' : 'light';
    }
    return mode;
  });

  /**
   * Subscribes to operating-system colour-scheme changes and applies the theme to the document.
   */
  public constructor() {
    this.prefersDarkQuery()?.addEventListener('change', (event: MediaQueryListEvent): void => {
      this.systemPrefersDark.set(event.matches);
    });

    // Another window may change the theme (the settings UI lives in the main window; pop-out
    // windows must follow live). The store's external-change notification only ever fires in the
    // windows that did not write, so re-applying the stored value here cannot echo back.
    this.settings.onExternalChange(MODE_KEY, (): void => {
      this.modeSignal.set(this.settings.get<ThemeMode>(MODE_KEY, DEFAULT_MODE));
      this.log.debug('Theme', 'Theme mode followed an external change', this.modeSignal());
    });
    this.settings.onExternalChange(ACCENT_KEY, (): void => {
      this.accentSignal.set(
        normaliseAccent(this.settings.get<unknown>(ACCENT_KEY, DEFAULT_ACCENT)),
      );
      this.log.debug('Theme', 'Accent followed an external change', this.accentSignal().kind);
    });

    effect((): void => {
      const root: HTMLElement = this.document.documentElement;
      root.dataset['themeMode'] = this.resolvedMode();
      root.style.setProperty('--accent-color', this.accentHex());
      root.style.setProperty('--accent-color-rgb', this.accentRgb());
    });
  }

  /**
   * Sets and persists the theme mode.
   * @param mode The theme mode to apply.
   */
  public setMode(mode: ThemeMode): void {
    this.modeSignal.set(mode);
    this.settings.set<ThemeMode>(MODE_KEY, mode);
    this.log.info('Theme', `Theme mode changed to '${mode}'`, this.resolvedMode());
  }

  /**
   * Sets and persists the accent.
   * @param accent The accent to apply.
   */
  public setAccent(accent: Accent): void {
    const normalised: Accent = normaliseAccent(accent);
    this.accentSignal.set(normalised);
    this.settings.set<Accent>(ACCENT_KEY, normalised);
    this.log.info('Theme', `Accent changed to ${normalised.kind}`, resolveAccent(normalised).hex);
  }

  /**
   * Gets the `prefers-color-scheme: dark` media query, or undefined when `matchMedia` is unavailable
   * (for example under unit tests or outside a browser environment).
   * @returns Returns the media query list, or undefined.
   */
  private prefersDarkQuery(): MediaQueryList | undefined {
    const view: (Window & typeof globalThis) | null = this.document.defaultView;
    if (view === null || typeof view.matchMedia !== 'function') {
      return undefined;
    }
    return view.matchMedia('(prefers-color-scheme: dark)');
  }
}
