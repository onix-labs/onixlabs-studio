/**
 * Milkdown plugin for color previews in inline code.
 *
 * Detects color values in inline code and renders a small color swatch:
 * - Hex colors: `#ff0000`, `#f00`
 * - RGB colors: `rgb(255, 0, 0)`
 * - RGBA colors: `rgba(255, 0, 0, 0.5)`
 * - HSL colors: `hsl(0, 100%, 50%)`
 * - HSLA colors: `hsla(0, 100%, 50%, 0.5)`
 */

import { $prose } from '@milkdown/kit/utils';
import type { $Prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import type { EditorState, EditorStateConfig } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import type { Transaction } from '@milkdown/prose/state';
import type { Node as ProseMirrorNode, Mark } from '@milkdown/prose/model';

/**
 * Maximum valid value for an 8-bit RGB colour channel.
 */
const MAX_RGB_CHANNEL: number = 255;

/**
 * Maximum valid value for an HSL hue, expressed in degrees.
 */
const MAX_HUE_DEGREES: number = 360;

/**
 * Maximum valid value for an HSL saturation or lightness percentage.
 */
const MAX_PERCENTAGE: number = 100;

/**
 * Threshold above which a node is considered to have at least one mark.
 */
const NO_MARKS: number = 0;

/**
 * Minimum valid value for an alpha channel.
 */
const MIN_ALPHA: number = 0;

/**
 * Maximum valid value for an alpha channel.
 */
const MAX_ALPHA: number = 1;

/**
 * Plugin key for the color preview plugin.
 */
const colorPreviewKey: PluginKey = new PluginKey('colorPreview');

/**
 * Pattern to match hex colors: #RGB, #RRGGBB, #RGBA, #RRGGBBAA
 */
const HEX_PATTERN: RegExp = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * Pattern to match rgb() colors.
 */
const RGB_PATTERN: RegExp = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i;

/**
 * Pattern to match rgba() colors.
 */
const RGBA_PATTERN: RegExp =
  /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*([\d.]+)\s*\)$/i;

/**
 * Pattern to match hsl() colors.
 */
const HSL_PATTERN: RegExp = /^hsl\(\s*(\d{1,3})\s*,\s*(\d{1,3})%\s*,\s*(\d{1,3})%\s*\)$/i;

/**
 * Pattern to match hsla() colors.
 */
const HSLA_PATTERN: RegExp =
  /^hsla\(\s*(\d{1,3})\s*,\s*(\d{1,3})%\s*,\s*(\d{1,3})%\s*,\s*([\d.]+)\s*\)$/i;

/**
 * Parses a color string and returns a valid CSS color value, or null if invalid.
 *
 * @param text The text to parse as a color.
 * @returns A valid CSS color string, or null if the text is not a valid color.
 */
function parseColor(text: string): string | null {
  const trimmed: string = text.trim();

  // Check hex color
  if (HEX_PATTERN.test(trimmed)) {
    return trimmed;
  }

  // Check rgb()
  const rgbMatch: RegExpMatchArray | null = RGB_PATTERN.exec(trimmed);
  if (rgbMatch) {
    const r: number = parseInt(rgbMatch[1], 10);
    const g: number = parseInt(rgbMatch[2], 10);
    const b: number = parseInt(rgbMatch[3], 10);
    if (r <= MAX_RGB_CHANNEL && g <= MAX_RGB_CHANNEL && b <= MAX_RGB_CHANNEL) {
      return `rgb(${r}, ${g}, ${b})`;
    }
  }

  // Check rgba()
  const rgbaMatch: RegExpMatchArray | null = RGBA_PATTERN.exec(trimmed);
  if (rgbaMatch) {
    const r: number = parseInt(rgbaMatch[1], 10);
    const g: number = parseInt(rgbaMatch[2], 10);
    const b: number = parseInt(rgbaMatch[3], 10);
    const a: number = parseFloat(rgbaMatch[4]);
    if (
      r <= MAX_RGB_CHANNEL &&
      g <= MAX_RGB_CHANNEL &&
      b <= MAX_RGB_CHANNEL &&
      a >= MIN_ALPHA &&
      a <= MAX_ALPHA
    ) {
      return `rgba(${r}, ${g}, ${b}, ${a})`;
    }
  }

  // Check hsl()
  const hslMatch: RegExpMatchArray | null = HSL_PATTERN.exec(trimmed);
  if (hslMatch) {
    const h: number = parseInt(hslMatch[1], 10);
    const s: number = parseInt(hslMatch[2], 10);
    const l: number = parseInt(hslMatch[3], 10);
    if (h <= MAX_HUE_DEGREES && s <= MAX_PERCENTAGE && l <= MAX_PERCENTAGE) {
      return `hsl(${h}, ${s}%, ${l}%)`;
    }
  }

  // Check hsla()
  const hslaMatch: RegExpMatchArray | null = HSLA_PATTERN.exec(trimmed);
  if (hslaMatch) {
    const h: number = parseInt(hslaMatch[1], 10);
    const s: number = parseInt(hslaMatch[2], 10);
    const l: number = parseInt(hslaMatch[3], 10);
    const a: number = parseFloat(hslaMatch[4]);
    if (
      h <= MAX_HUE_DEGREES &&
      s <= MAX_PERCENTAGE &&
      l <= MAX_PERCENTAGE &&
      a >= MIN_ALPHA &&
      a <= MAX_ALPHA
    ) {
      return `hsla(${h}, ${s}%, ${l}%, ${a})`;
    }
  }

  return null;
}

/**
 * Creates a color swatch DOM element.
 *
 * @param color The CSS color value.
 * @returns A span element styled as a color swatch.
 */
function createColorSwatch(color: string): HTMLElement {
  const swatch: HTMLSpanElement = document.createElement('span');
  swatch.className = 'color-preview-swatch';
  swatch.style.backgroundColor = color;
  swatch.setAttribute('aria-hidden', 'true');
  return swatch;
}

/**
 * Finds all inline code nodes with color values and creates decorations for them.
 *
 * @param doc The ProseMirror document.
 * @returns An array of decorations with color swatch widgets.
 */
function findColorDecorations(doc: ProseMirrorNode): Decoration[] {
  const decorations: Decoration[] = [];

  doc.descendants((node: ProseMirrorNode, pos: number): boolean => {
    // Look for text nodes with the inlineCode mark
    if (node.isText && node.marks.length > NO_MARKS) {
      const hasCodeMark: boolean = node.marks.some(
        (mark: Mark): boolean => mark.type.name === 'inlineCode',
      );
      if (hasCodeMark && node.text) {
        const color: string | null = parseColor(node.text);
        if (color) {
          // Add a widget decoration before the inline code
          const widget: Decoration = Decoration.widget(
            pos,
            (): HTMLElement => createColorSwatch(color),
            {
              side: -1, // Place before the content
              key: `color-${pos}`,
            },
          );
          decorations.push(widget);
        }
      }
    }
    return true; // Continue traversing
  });

  return decorations;
}

/**
 * ProseMirror plugin that adds color swatches to inline code containing color values.
 */
export const colorPreviewPlugin: $Prose = $prose((): Plugin => {
  return new Plugin<DecorationSet>({
    key: colorPreviewKey,
    state: {
      init(config: EditorStateConfig, instance: EditorState): DecorationSet {
        const decorations: Decoration[] = findColorDecorations(instance.doc);
        return DecorationSet.create(instance.doc, decorations);
      },
      apply(tr: Transaction, oldState: DecorationSet): DecorationSet {
        if (tr.docChanged) {
          const decorations: Decoration[] = findColorDecorations(tr.doc);
          return DecorationSet.create(tr.doc, decorations);
        }
        return oldState.map(tr.mapping, tr.doc);
      },
    },
    props: {
      decorations(state: EditorState): DecorationSet | undefined {
        return this.getState(state);
      },
    },
  });
});

/**
 * Export for parseColor for testing.
 */
export { parseColor };
