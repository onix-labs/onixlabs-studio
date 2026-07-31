/**
 * Holds the lowest saturation a custom accent may take. Clamping above zero keeps a custom accent a
 * recognisable colour: it can range from fully saturated to subtle/pastel, but never collapses to a
 * neutral grey.
 */
export const MIN_SATURATION: number = 12;

/**
 * Holds the highest saturation a custom accent may take.
 */
export const MAX_SATURATION: number = 100;

/**
 * Holds the fixed lightness applied to every custom accent. Lightness is not user-adjustable: keeping
 * it constant guarantees a custom accent stays legible against both light and dark surfaces, matching
 * the guarantee the hand-picked presets give.
 */
export const CUSTOM_LIGHTNESS: number = 50;

/**
 * Represents a colour decomposed into red, green and blue channels (each 0–255).
 */
export interface Rgb {
  /**
   * Gets the red channel (0–255).
   */
  readonly r: number;

  /**
   * Gets the green channel (0–255).
   */
  readonly g: number;

  /**
   * Gets the blue channel (0–255).
   */
  readonly b: number;
}

/**
 * Represents a colour in the hue/saturation/lightness space.
 */
export interface Hsl {
  /**
   * Gets the hue in degrees (0–360).
   */
  readonly hue: number;

  /**
   * Gets the saturation as a percentage (0–100).
   */
  readonly saturation: number;

  /**
   * Gets the lightness as a percentage (0–100).
   */
  readonly lightness: number;
}

/**
 * Wraps a hue into the range [0, 360).
 * @param hue The hue in degrees.
 * @returns Returns the normalised hue.
 */
export function normaliseHue(hue: number): number {
  const wrapped: number = hue % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/**
 * Clamps a saturation to the permitted custom-accent range, keeping a custom accent recognisable
 * (never a neutral grey) while still allowing subtle, pastel tones.
 * @param saturation The saturation as a percentage.
 * @returns Returns the clamped saturation.
 */
export function clampSaturation(saturation: number): number {
  return Math.min(MAX_SATURATION, Math.max(MIN_SATURATION, Math.round(saturation)));
}

/**
 * Converts an HSL colour to its RGB channels.
 * @param hsl The HSL colour.
 * @returns Returns the RGB channels.
 */
export function hslToRgb(hsl: Hsl): Rgb {
  const h: number = normaliseHue(hsl.hue) / 360;
  const s: number = Math.min(100, Math.max(0, hsl.saturation)) / 100;
  const l: number = Math.min(100, Math.max(0, hsl.lightness)) / 100;

  if (s === 0) {
    const grey: number = Math.round(l * 255);
    return { r: grey, g: grey, b: grey };
  }

  const q: number = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p: number = 2 * l - q;
  return {
    r: Math.round(hueToChannel(p, q, h + 1 / 3) * 255),
    g: Math.round(hueToChannel(p, q, h) * 255),
    b: Math.round(hueToChannel(p, q, h - 1 / 3) * 255),
  };
}

/**
 * Formats RGB channels as a bare `r, g, b` triplet, the form the accent surface tokens interpolate
 * into `rgba(...)` overlays.
 * @param rgb The RGB channels.
 * @returns Returns the triplet string.
 */
export function rgbToTriplet(rgb: Rgb): string {
  return `${rgb.r}, ${rgb.g}, ${rgb.b}`;
}

/**
 * Formats RGB channels as a `#rrggbb` hex string.
 * @param rgb The RGB channels.
 * @returns Returns the hex string.
 */
export function rgbToHex(rgb: Rgb): string {
  return `#${channelToHex(rgb.r)}${channelToHex(rgb.g)}${channelToHex(rgb.b)}`;
}

/**
 * Parses a `#rgb` or `#rrggbb` hex string into RGB channels, falling back to black on a malformed
 * value rather than throwing.
 * @param hex The hex colour string.
 * @returns Returns the RGB channels.
 */
export function hexToRgb(hex: string): Rgb {
  const value: string = hex.replace('#', '').trim();
  const full: string =
    value.length === 3
      ? value
          .split('')
          .map((character: string): string => character + character)
          .join('')
      : value;
  if (full.length !== 6) {
    return { r: 0, g: 0, b: 0 };
  }
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/**
 * Converts RGB channels to their HSL representation.
 * @param rgb The RGB channels.
 * @returns Returns the HSL colour.
 */
export function rgbToHsl(rgb: Rgb): Hsl {
  const r: number = rgb.r / 255;
  const g: number = rgb.g / 255;
  const b: number = rgb.b / 255;
  const max: number = Math.max(r, g, b);
  const min: number = Math.min(r, g, b);
  const lightness: number = (max + min) / 2;

  if (max === min) {
    return { hue: 0, saturation: 0, lightness: Math.round(lightness * 100) };
  }

  const delta: number = max - min;
  const saturation: number =
    lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);

  let hue: number;
  switch (max) {
    case r:
      hue = (g - b) / delta + (g < b ? 6 : 0);
      break;
    case g:
      hue = (b - r) / delta + 2;
      break;
    default:
      hue = (r - g) / delta + 4;
      break;
  }

  return {
    hue: Math.round(hue * 60),
    saturation: Math.round(saturation * 100),
    lightness: Math.round(lightness * 100),
  };
}

/**
 * Converts a hex colour to its HSL representation.
 * @param hex The hex colour string.
 * @returns Returns the HSL colour.
 */
export function hexToHsl(hex: string): Hsl {
  return rgbToHsl(hexToRgb(hex));
}

/**
 * Resolves a single RGB channel from the two intermediates and a hue offset, the standard HSL→RGB
 * helper.
 * @param p The lower intermediate.
 * @param q The upper intermediate.
 * @param t The hue offset (may fall outside [0, 1]).
 * @returns Returns the channel as a fraction (0–1).
 */
function hueToChannel(p: number, q: number, t: number): number {
  let offset: number = t;
  if (offset < 0) offset += 1;
  if (offset > 1) offset -= 1;
  if (offset < 1 / 6) return p + (q - p) * 6 * offset;
  if (offset < 1 / 2) return q;
  if (offset < 2 / 3) return p + (q - p) * (2 / 3 - offset) * 6;
  return p;
}

/**
 * Formats a single channel (0–255) as a two-digit hex string.
 * @param channel The channel value.
 * @returns Returns the two-digit hex string.
 */
function channelToHex(channel: number): string {
  return Math.min(255, Math.max(0, Math.round(channel))).toString(16).padStart(2, '0');
}
