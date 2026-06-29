import { computed, inject, Service, Signal } from '@angular/core';
import {
  ImageAlignment,
  ImageSizing,
  MarginSize,
  MarkdownEditorSettings,
  Settings,
} from '@shared/angular/services/settings/settings';

/**
 * Holds the system default sans-serif font stack applied when the markdown body font is unset.
 */
const SYSTEM_SANS_SERIF: string =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif';

/**
 * Holds the system default monospace font stack appended behind the chosen code font.
 */
const SYSTEM_MONOSPACE: string =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

/**
 * Holds the sentinel font-family value that resolves to the system sans-serif stack.
 */
const SYSTEM_DEFAULT_FONT: string = 'System Default';

/**
 * Resolves the markdown editor's settings into the CSS custom properties and layout values the
 * {@link MarkdownView} applies to its Crepe editor element.
 *
 * The values are derived from {@link Settings.markdownEditor}; theme colours are handled entirely in
 * the global `_milkdown.scss` stylesheet via the `data-theme-mode` attribute, so this service is only
 * concerned with fonts, sizing and document margins.
 */
@Service()
export class Milkdown {
  /**
   * Holds the settings service supplying the markdown editor preferences.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Gets the markdown editor settings.
   */
  public readonly markdownSettings: Signal<MarkdownEditorSettings> = this.settings.markdownEditor;

  /**
   * Gets the document margin size, which the view maps to a max-width class.
   */
  public readonly marginSize: Signal<MarginSize> = computed(
    (): MarginSize => this.markdownSettings().marginSize,
  );

  /**
   * Gets the image sizing behaviour, which selects whether Crepe's resizable image block is enabled.
   */
  public readonly imageSizing: Signal<ImageSizing> = computed(
    (): ImageSizing => this.markdownSettings().imageSizing,
  );

  /**
   * Gets the image alignment, which the view maps to a class that horizontally aligns images.
   */
  public readonly imageAlignment: Signal<ImageAlignment> = computed(
    (): ImageAlignment => this.markdownSettings().imageAlignment,
  );

  /**
   * Builds the CSS custom properties applied to the `.milkdown` element so the editor honours the
   * configured fonts and base size.
   * @returns Returns a map of custom property names to their resolved values.
   */
  public getCssCustomProperties(): Record<string, string> {
    const settings: MarkdownEditorSettings = this.markdownSettings();
    return {
      '--markdown-font-family': this.resolveFontFamily(settings.fontFamily),
      '--markdown-monospace-font': this.resolveMonospaceFont(settings.monospaceFontFamily),
      '--markdown-font-size': `${settings.fontSize}px`,
    };
  }

  /**
   * Resolves a body font-family name to a CSS font stack, falling back to the system sans-serif stack.
   * @param fontFamily The configured font-family name.
   * @returns Returns the CSS font stack string.
   */
  private resolveFontFamily(fontFamily: string): string {
    if (fontFamily === SYSTEM_DEFAULT_FONT) {
      return SYSTEM_SANS_SERIF;
    }
    return `"${fontFamily}", ${SYSTEM_SANS_SERIF}`;
  }

  /**
   * Resolves a monospace font name to a CSS font stack, appending the system monospace fallback.
   * @param fontFamily The configured monospace font name.
   * @returns Returns the CSS font stack string.
   */
  private resolveMonospaceFont(fontFamily: string): string {
    return `"${fontFamily}", ${SYSTEM_MONOSPACE}`;
  }
}
