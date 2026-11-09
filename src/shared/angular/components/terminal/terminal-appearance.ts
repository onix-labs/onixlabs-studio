import type { ITheme } from '@xterm/xterm';
import {
  TERMINAL_FONT_SAME_AS_CODE,
  type TerminalCursorStyle,
  type TerminalRenderer,
} from '@shared/angular/services/settings/settings-registry';
import type { ResolvedGraphicsAcceleration } from '@shared/angular/services/display/display-policy';

/**
 * Holds the fonts a terminal falls back on, after the one chosen, when a glyph is missing from it.
 */
const FALLBACK_FONTS: string = '"JetBrains Mono", "Menlo", "Consolas", monospace';

/**
 * Holds the smallest font size a zoomed terminal is drawn at, so a far zoom-out stays legible.
 */
const MIN_FONT_SIZE: number = 6;

/**
 * Describes what a terminal's look is worked out from: its own settings, Code's font, the editor zoom
 * and the graphics level in force.
 */
export interface TerminalAppearanceInputs {
  /**
   * Gets Terminal's Font Family, or {@link TERMINAL_FONT_SAME_AS_CODE}.
   */
  readonly fontFamily: string;

  /**
   * Gets Terminal's Font Size, or 0 for Code's.
   */
  readonly fontSize: number;

  /**
   * Gets Code's font family.
   */
  readonly codeFontFamily: string;

  /**
   * Gets Code's font size.
   */
  readonly codeFontSize: number;

  /**
   * Gets the editor zoom, as a percentage.
   */
  readonly zoomPercent: number;

  /**
   * Gets Scrollback Lines.
   */
  readonly scrollback: number;

  /**
   * Gets Cursor Style.
   */
  readonly cursorStyle: TerminalCursorStyle;

  /**
   * Gets Cursor Blink.
   */
  readonly cursorBlink: boolean;

  /**
   * Gets Renderer.
   */
  readonly renderer: TerminalRenderer;

  /**
   * Gets the graphics-acceleration level in force.
   */
  readonly graphics: ResolvedGraphicsAcceleration;

  /**
   * Gets whether the pane is a read-only task console, which never blinks.
   */
  readonly readOnly: boolean;
}

/**
 * Describes the xterm options a terminal's settings come to, and whether it draws on the GPU.
 */
export interface TerminalAppearance {
  /**
   * Gets the CSS font-family list.
   */
  readonly fontFamily: string;

  /**
   * Gets the font size in pixels, zoom applied.
   */
  readonly fontSize: number;

  /**
   * Gets how many lines of scrollback are kept.
   */
  readonly scrollback: number;

  /**
   * Gets the cursor's shape.
   */
  readonly cursorStyle: TerminalCursorStyle;

  /**
   * Gets whether the cursor blinks.
   */
  readonly cursorBlink: boolean;

  /**
   * Gets whether the terminal draws on the GPU.
   */
  readonly gpu: boolean;
}

/**
 * Works out a terminal's look from its settings. "Same as Code" reads Code's font and size; either
 * size follows the editor zoom; the GPU is used only when chosen and while acceleration is on.
 * @param inputs What the look is worked out from.
 * @returns Returns the look.
 */
export function terminalAppearance(inputs: TerminalAppearanceInputs): TerminalAppearance {
  const family: string =
    inputs.fontFamily === TERMINAL_FONT_SAME_AS_CODE ? inputs.codeFontFamily : inputs.fontFamily;
  const size: number = inputs.fontSize > 0 ? inputs.fontSize : inputs.codeFontSize;
  return {
    fontFamily: `"${family.replace(/"/g, '')}", ${FALLBACK_FONTS}`,
    fontSize: Math.max(MIN_FONT_SIZE, Math.round((size * inputs.zoomPercent) / 100)),
    scrollback: inputs.scrollback,
    cursorStyle: inputs.cursorStyle,
    cursorBlink: inputs.cursorBlink && !inputs.readOnly,
    gpu: inputs.renderer === 'gpu' && inputs.graphics !== 'off',
  };
}

/**
 * Holds the sixteen ANSI colours a terminal draws in on a dark background: readable against the
 * app's near-black ink, bright variants a step lighter.
 */
const DARK_PALETTE: Partial<ITheme> = {
  black: '#1e1e1e',
  red: '#f14c4c',
  green: '#23d18b',
  yellow: '#e5e510',
  blue: '#3b8eea',
  magenta: '#d670d6',
  cyan: '#29b8db',
  white: '#cccccc',
  brightBlack: '#767676',
  brightRed: '#ff6b6b',
  brightGreen: '#3ee8a2',
  brightYellow: '#f5f543',
  brightBlue: '#6aaaf5',
  brightMagenta: '#e78ee7',
  brightCyan: '#5fd2ee',
  brightWhite: '#ffffff',
};

/**
 * Holds the sixteen ANSI colours a terminal draws in on a light background: dark enough to read on
 * near-white, with yellow and white — unreadable as written for a dark screen — taken down to tones
 * that still show.
 */
const LIGHT_PALETTE: Partial<ITheme> = {
  black: '#000000',
  red: '#cd3131',
  green: '#107c41',
  yellow: '#8a6d00',
  blue: '#0451a5',
  magenta: '#bc05bc',
  cyan: '#0e7c94',
  white: '#6e6e6e',
  brightBlack: '#5a5a5a',
  brightRed: '#e01b1b',
  brightGreen: '#0f8a46',
  brightYellow: '#9c7c00',
  brightBlue: '#0a63c9',
  brightMagenta: '#a21aa2',
  brightCyan: '#0b8aa5',
  brightWhite: '#333333',
};

/**
 * Gets the ANSI palette matching the app's mode.
 * @param dark Whether the app is drawn dark.
 * @returns Returns the sixteen colours.
 */
export function terminalPalette(dark: boolean): Partial<ITheme> {
  return dark ? DARK_PALETTE : LIGHT_PALETTE;
}
