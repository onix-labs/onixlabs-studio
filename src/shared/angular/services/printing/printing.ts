import { DOCUMENT, effect, inject, Service } from '@angular/core';
import { Settings } from '@shared/angular/services/settings/settings';
import type { PrintMargin } from '@shared/angular/services/settings/settings';

/**
 * Maps each print-margin choice to its `@page` margin value. The values are the vertical then
 * horizontal margins; `regular` doubles `narrow` and `wide` doubles `regular`, so the three steps are a
 * clean progression from a tight margin to a generous one.
 */
const PRINT_MARGINS: Readonly<Record<PrintMargin, string>> = {
  narrow: '1.4cm 1cm',
  regular: '2.8cm 2cm',
  wide: '5.6cm 4cm',
};

/**
 * Projects the user's print-margin setting onto the printed page.
 *
 * The page margin belongs in an `@page` rule, but Chromium does not reliably honour a CSS custom
 * property inside `@page`, so the rule text cannot be driven by a projected variable the way the theme
 * colours are. Instead this service owns a single `<style>` element whose `@page` rule is rewritten
 * whenever the setting changes — the one authoritative source of the print margin (the print stylesheet
 * deliberately declares none). Instantiated at start-up so the margin is in place before the first
 * print.
 */
@Service()
export class Printing {
  /**
   * Holds the settings service the print margin is read from.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the document the `@page` style element is appended to.
   */
  private readonly document: Document = inject(DOCUMENT);

  /**
   * Holds the style element carrying the `@page` margin rule.
   */
  private readonly styleElement: HTMLStyleElement = this.document.createElement('style');

  /**
   * Initialises the service, keeping the `@page` margin rule in sync with the setting.
   */
  public constructor() {
    this.styleElement.dataset['printMargin'] = '';
    this.document.head.appendChild(this.styleElement);

    effect((): void => {
      const margin: string = PRINT_MARGINS[this.settings.value('application.printMargin')()];
      this.styleElement.textContent = `@page { margin: ${margin}; }`;
    });
  }
}
