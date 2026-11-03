import type { PrintPageSize } from '@shared/api/print-channels';
import type { PrintPaperSize } from '@shared/angular/services/settings/settings';

/**
 * Holds the regions whose standard paper is US Letter rather than A4: the United States and Canada,
 * most of Central America and the Caribbean, and several South American countries and the Philippines.
 */
const LETTER_REGIONS: ReadonlySet<string> = new Set<string>([
  'US',
  'CA',
  'MX',
  'GT',
  'BZ',
  'SV',
  'HN',
  'NI',
  'CR',
  'PA',
  'PR',
  'DO',
  'CO',
  'VE',
  'CL',
  'PH',
]);

/**
 * Maps each chosen paper size, other than `system`, to the name Chromium's print path gives it.
 */
const PAGE_SIZES: Readonly<Record<Exclude<PrintPaperSize, 'system'>, PrintPageSize>> = {
  a4: 'A4',
  letter: 'Letter',
  legal: 'Legal',
  a3: 'A3',
};

/**
 * Resolves the paper size setting to the paper Chromium prints on. `system` is Letter in the regions
 * that use it and A4 everywhere else, judged by the region of the locale. A locale naming no region
 * takes its likely one (`en` is the United States); one that cannot be parsed falls back to A4.
 * @param paperSize The paper size setting.
 * @param locale The locale whose region decides `system`, such as `en-US`.
 * @returns Returns the paper size to print on.
 */
export function resolvePageSize(paperSize: PrintPaperSize, locale: string): PrintPageSize {
  if (paperSize !== 'system') {
    return PAGE_SIZES[paperSize];
  }
  return LETTER_REGIONS.has(regionOf(locale)) ? 'Letter' : 'A4';
}

/**
 * Reads the region of a locale, filling in the likely region when the locale names none.
 * @param locale The locale.
 * @returns Returns the upper-case region code, or the empty string when there is none.
 */
function regionOf(locale: string): string {
  try {
    return new Intl.Locale(locale).maximize().region?.toUpperCase() ?? '';
  } catch {
    return '';
  }
}
