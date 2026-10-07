import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import {
  ButtonGroup,
  ButtonGroupOption,
} from '@shared/angular/components/forms/button-group/button-group';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { ACCENT_PRESETS, AccentPreset, resolveAccent } from '@shared/angular/services/theme/theme';
import { CanvasEvent, CanvasFrame } from './canvas-frame';
import { SPECIMEN_PAGES } from './agent-prompt-specimens';
import type { SpecimenPage } from './specimen';

/**
 * Names a theme a pane is drawn in.
 */
type PaneTheme = 'light' | 'dark';

/**
 * Describes a width a specimen is drawn at.
 */
interface CanvasWidth {
  /**
   * Gets the width's name.
   */
  readonly label: string;

  /**
   * Gets the width in pixels.
   */
  readonly px: number;
}

/**
 * The widths every specimen is drawn at: a narrow docked Agent panel, a typical one, and a wide tab.
 */
const WIDTHS: readonly CanvasWidth[] = [
  { label: 'Narrow', px: 280 },
  { label: 'Typical', px: 400 },
  { label: 'Wide', px: 720 },
];

/**
 * The design canvas (#855): every state of a component, side by side, at the widths it is used at and
 * in both themes, from fixtures rather than a live agent. Dev-only — see `canvas-entry.ts`. The theme
 * and accent here are the canvas's own; nothing the user saved is changed.
 */
@Component({
  selector: 'app-canvas-root',
  imports: [ButtonGroup, Dropdown, CanvasFrame],
  templateUrl: './canvas-root.html',
  styleUrl: './canvas-root.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    // The canvas's chrome is dark whatever the document root says — the components it renders can
    // start Studio's Theme service, which writes the user's saved mode there.
    'data-theme-mode': 'dark',
    '[style.--accent-color]': 'accentColor().hex',
    '[style.--accent-color-rgb]': 'accentColor().rgb',
  },
})
export class CanvasRoot {
  /**
   * Gets the pages.
   */
  protected readonly pages: readonly SpecimenPage[] = SPECIMEN_PAGES;

  /**
   * Gets the widths.
   */
  protected readonly widths: readonly CanvasWidth[] = WIDTHS;

  /**
   * Holds the page shown, by title.
   */
  protected readonly pageTitle: WritableSignal<string> = signal<string>(SPECIMEN_PAGES[0].title);

  /**
   * Gets the page shown.
   */
  protected readonly page: Signal<SpecimenPage> = computed(
    (): SpecimenPage =>
      this.pages.find((page: SpecimenPage): boolean => page.title === this.pageTitle()) ??
      this.pages[0],
  );

  /**
   * Holds which themes are shown: `both`, `light` or `dark`.
   */
  protected readonly themeChoice: WritableSignal<string> = signal<string>('both');

  /**
   * Gets the themes shown, in order.
   */
  protected readonly themes: Signal<readonly PaneTheme[]> = computed((): readonly PaneTheme[] =>
    this.themeChoice() === 'both' ? ['light', 'dark'] : [this.themeChoice() as PaneTheme],
  );

  /**
   * Holds what the cards are drawn on: an Agent tab's page, or a docked Agent panel's surface.
   */
  protected readonly backdrop: WritableSignal<string> = signal<string>('panel');

  /**
   * Gets the backdrop choices.
   */
  protected readonly backdropOptions: readonly ButtonGroupOption[] = [
    { value: 'panel', label: 'Panel' },
    { value: 'tab', label: 'Tab' },
  ];

  /**
   * Holds the accent preset shown.
   */
  protected readonly accent: WritableSignal<string> = signal<string>('blue');

  /**
   * Holds the last thing a specimen emitted.
   */
  protected readonly lastEvent: WritableSignal<CanvasEvent | null> = signal<CanvasEvent | null>(
    null,
  );

  /**
   * Gets the theme choices.
   */
  protected readonly themeOptions: readonly ButtonGroupOption[] = [
    { value: 'both', label: 'Both' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];

  /**
   * Gets the accent choices.
   */
  protected readonly accentOptions: readonly DropdownOption[] = ACCENT_PRESETS.map(
    (preset: AccentPreset): DropdownOption => ({ value: preset.id, label: preset.label }),
  );

  /**
   * Gets the page choices.
   */
  protected readonly pageOptions: readonly ButtonGroupOption[] = SPECIMEN_PAGES.map(
    (page: SpecimenPage): ButtonGroupOption => ({ value: page.title, label: page.title }),
  );

  /**
   * Gets the canvas's accent, applied on the canvas itself (see the host bindings) rather than on the
   * document: the components it renders can start Studio's Theme service, which writes the user's
   * saved accent to the document root, and a value on the canvas takes precedence over that.
   */
  protected readonly accentColor: Signal<{ readonly hex: string; readonly rgb: string }> = computed(
    (): { readonly hex: string; readonly rgb: string } =>
      resolveAccent({ kind: 'preset', id: this.accent() }),
  );
}
