import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
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
   * Holds the document.
   */
  private readonly document: Document = inject(DOCUMENT);

  /**
   * Applies the canvas's accent to the document, as the Theme service would.
   */
  private readonly applyAccent: ReturnType<typeof effect> = effect((): void => {
    const root: HTMLElement = this.document.documentElement;
    const resolved: { readonly hex: string; readonly rgb: string } = resolveAccent({
      kind: 'preset',
      id: this.accent(),
    });
    root.style.setProperty('--accent-color', resolved.hex);
    root.style.setProperty('--accent-color-rgb', resolved.rgb);
  });
}
