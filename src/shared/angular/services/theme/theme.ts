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
import { SettingsStore } from '../settings-store/settings-store';

/**
 * Identifies the theme mode the user can choose. `system` follows the operating system preference.
 */
export type ThemeMode = 'light' | 'dark' | 'system';

/**
 * Identifies the effective theme actually applied to the document, after resolving `system`.
 */
export type ResolvedThemeMode = 'light' | 'dark';

/**
 * Identifies an accent colour from the palette.
 */
export type AccentColor =
  | 'orange'
  | 'yellow'
  | 'coral'
  | 'tangerine'
  | 'red'
  | 'pink'
  | 'magenta'
  | 'purple'
  | 'violet'
  | 'indigo'
  | 'blue'
  | 'azure'
  | 'cyan'
  | 'mint'
  | 'teal'
  | 'sky'
  | 'green'
  | 'emerald';

/**
 * Lists the accent colours in palette order, for rendering pickers.
 */
export const ACCENT_COLORS: readonly AccentColor[] = [
  'orange',
  'yellow',
  'coral',
  'tangerine',
  'red',
  'pink',
  'magenta',
  'purple',
  'violet',
  'indigo',
  'blue',
  'azure',
  'cyan',
  'mint',
  'teal',
  'sky',
  'green',
  'emerald',
];

/**
 * Holds the settings key under which the theme mode is persisted.
 */
const MODE_KEY: string = 'theme.mode';

/**
 * Holds the settings key under which the accent colour is persisted.
 */
const ACCENT_KEY: string = 'theme.accent';

/**
 * Holds the theme mode applied when no preference has been persisted.
 */
const DEFAULT_MODE: ThemeMode = 'system';

/**
 * Holds the accent colour applied when no preference has been persisted.
 */
const DEFAULT_ACCENT: AccentColor = 'blue';

/**
 * Represents the source of truth for the application's theme mode and accent colour.
 *
 * Choices are restored from the {@link SettingsStore} on construction, exposed as signals, and
 * applied to the document root by an effect: the resolved light/dark mode drives the
 * `data-theme-mode` attribute that the SCSS theme switches on, and the accent is projected onto the
 * `--accent-color` custom properties. `system` mode is resolved through `matchMedia` and tracks live
 * operating-system changes.
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
   * Holds the chosen theme mode.
   */
  private readonly modeSignal: WritableSignal<ThemeMode> = signal<ThemeMode>(
    this.settings.get<ThemeMode>(MODE_KEY, DEFAULT_MODE),
  );

  /**
   * Holds the chosen accent colour.
   */
  private readonly accentSignal: WritableSignal<AccentColor> = signal<AccentColor>(
    this.settings.get<AccentColor>(ACCENT_KEY, DEFAULT_ACCENT),
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
   * Gets the chosen accent colour.
   */
  public readonly accent: Signal<AccentColor> = this.accentSignal.asReadonly();

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
    });
    this.settings.onExternalChange(ACCENT_KEY, (): void => {
      this.accentSignal.set(this.settings.get<AccentColor>(ACCENT_KEY, DEFAULT_ACCENT));
    });

    effect((): void => {
      const root: HTMLElement = this.document.documentElement;
      root.dataset['themeMode'] = this.resolvedMode();
      root.style.setProperty('--accent-color', `var(--accent-${this.accentSignal()})`);
      root.style.setProperty('--accent-color-rgb', `var(--accent-${this.accentSignal()}-rgb)`);
    });
  }

  /**
   * Sets and persists the theme mode.
   * @param mode The theme mode to apply.
   */
  public setMode(mode: ThemeMode): void {
    this.modeSignal.set(mode);
    this.settings.set<ThemeMode>(MODE_KEY, mode);
  }

  /**
   * Sets and persists the accent colour.
   * @param accent The accent colour to apply.
   */
  public setAccent(accent: AccentColor): void {
    this.accentSignal.set(accent);
    this.settings.set<AccentColor>(ACCENT_KEY, accent);
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
