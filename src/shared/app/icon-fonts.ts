/**
 * The Phosphor icon webfont families, one per weight registered in `angular.json`'s `styles` array
 * and drawn from by the {@link import('@shared/angular/icons/icon').Icon} token.
 *
 * This list must stay in step with that array: a weight registered there but missing here is fetched
 * lazily again (the very cost {@link warmIconFonts} exists to avoid), and one named here but not
 * registered simply never resolves. `icon-fonts.spec.ts` holds the two in step.
 */
export const ICON_FONT_FAMILIES: readonly string[] = [
  'Phosphor',
  'Phosphor-Thin',
  'Phosphor-Light',
  'Phosphor-Bold',
  'Phosphor-Fill',
  'Phosphor-Duotone',
];

/**
 * Starts downloading the icon webfonts immediately, rather than leaving each one to be fetched the
 * first time a glyph of that weight is painted.
 *
 * A webfont is only requested when something needs it, and the main window paints no icons at all
 * until its first tab opens — so all six weights (~880 kB) were being fetched at that moment, and
 * Phosphor ships `font-display: block`, which renders text INVISIBLE rather than falling back while a
 * font is in flight. The first new tab therefore opened onto a blank view for as long as the fetch
 * took. Kicking the loads off at startup overlaps them with bootstrap and with the welcome screen,
 * which is on screen and doing nothing else.
 *
 * Best-effort throughout: a font set the environment does not implement, or a face that fails to
 * load, simply leaves the original lazy behaviour in place.
 * @param target The document whose font set to warm; defaults to the ambient one.
 */
export function warmIconFonts(target: Document = document): void {
  const fonts: FontFaceSet | undefined = target.fonts;
  if (fonts === undefined) {
    return;
  }
  for (const family of ICON_FONT_FAMILIES) {
    // The face carries no unicode-range, so any probe text matches it and triggers the download.
    void fonts.load(`1rem "${family}"`).catch((): void => undefined);
  }
}
