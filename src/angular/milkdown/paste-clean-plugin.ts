import { $prose } from '@milkdown/kit/utils';
import type { $Prose } from '@milkdown/utils';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';

/**
 * Lowest CSS `font-weight` ProseMirror's strong-mark parser treats as bold. Its rule bolds any
 * weight of 500 or more (plus the `bold`/`bolder` keywords).
 */
const MEDIUM_WEIGHT_MIN: number = 500;

/**
 * Lowest CSS `font-weight` considered a genuine bold intent. Weights at or above this are preserved
 * so emphasis copied from rich sources (e.g. word processors using `font-weight: 700`) survives.
 */
const BOLD_WEIGHT_MIN: number = 700;

/**
 * Plugin key for the paste-cleaning ProseMirror plugin.
 */
const pasteCleanKey: PluginKey = new PluginKey('paste-clean-font-weight');

/**
 * Removes inline `font-weight` declarations in the wrongly-bolded "medium" range (500–699) from the
 * given pasted HTML, leaving every other style untouched. The element's other inline styles, and any
 * genuine bold (the `bold`/`bolder` keywords, weights of 700 or more, or `<strong>`/`<b>` tags), are
 * preserved.
 * @param html The pasted HTML fragment.
 * @returns The HTML with stray medium font-weights stripped.
 */
function stripMediumFontWeight(html: string): string {
  const parsed: Document = new DOMParser().parseFromString(html, 'text/html');
  const styled: NodeListOf<HTMLElement> = parsed.body.querySelectorAll<HTMLElement>('[style]');
  for (const element of Array.from(styled)) {
    const weight: number = Number.parseInt(element.style.fontWeight, 10);
    if (Number.isFinite(weight) && weight >= MEDIUM_WEIGHT_MIN && weight < BOLD_WEIGHT_MIN) {
      element.style.removeProperty('font-weight');
    }
  }
  return parsed.body.innerHTML;
}

/**
 * Cleans pasted clipboard HTML before ProseMirror parses it.
 *
 * ProseMirror's strong-mark parser bolds any run carrying a CSS `font-weight` of 500 or more. Many
 * applications render their normal UI text at a medium/semibold weight (500–600), so copying plain
 * text from them and pasting it here would turn the whole paste bold. This plugin strips those stray
 * medium weights so such text pastes as normal, while leaving genuine bold (weights of 700 or more,
 * the `bold`/`bolder` keywords, and `<strong>`/`<b>` tags) intact.
 */
export const pasteCleanPlugin: $Prose = $prose(
  (): Plugin =>
    new Plugin({
      key: pasteCleanKey,
      props: {
        transformPastedHTML: (html: string): string => stripMediumFontWeight(html),
      },
    }),
);
