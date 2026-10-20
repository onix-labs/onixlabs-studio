// The colour maths behind Studio's colour picker (#1025): reading a CSS colour as written — hex,
// `rgb()`/`rgba()`, `hsl()`/`hsla()` in the legacy comma syntax or the modern space syntax, or a named
// colour — remembering how it was written, and writing a new colour back the same way. Pure: no DOM,
// no Monaco, no Angular.

/**
 * A colour as red, green and blue channels and an alpha.
 */
export interface Rgba {
  /**
   * Gets the red channel, 0–255; may be fractional.
   */
  readonly red: number;

  /**
   * Gets the green channel, 0–255; may be fractional.
   */
  readonly green: number;

  /**
   * Gets the blue channel, 0–255; may be fractional.
   */
  readonly blue: number;

  /**
   * Gets the alpha, 0 (transparent) to 1 (opaque).
   */
  readonly alpha: number;
}

/**
 * A colour as hue, saturation and lightness and an alpha.
 */
export interface Hsla {
  /**
   * Gets the hue in degrees, 0 up to 360.
   */
  readonly hue: number;

  /**
   * Gets the saturation, 0–100.
   */
  readonly saturation: number;

  /**
   * Gets the lightness, 0–100.
   */
  readonly lightness: number;

  /**
   * Gets the alpha, 0–1.
   */
  readonly alpha: number;
}

/**
 * A colour as hue, saturation and value (brightness) and an alpha: what the colour wheel picks, with
 * the hue round the wheel, the saturation out from its centre, and the value beside it.
 */
export interface Hsva {
  /**
   * Gets the hue in degrees, 0 up to 360.
   */
  readonly hue: number;

  /**
   * Gets the saturation, 0–100.
   */
  readonly saturation: number;

  /**
   * Gets the value, 0–100.
   */
  readonly value: number;

  /**
   * Gets the alpha, 0–1.
   */
  readonly alpha: number;
}

/**
 * Names the ways a colour can be written: a hex code, an `rgb()` function, or an `hsl()` function.
 */
export type ColourFamily = 'hex' | 'rgb' | 'hsl';

/**
 * Names the units a hue can be written in; empty for a bare number (degrees).
 */
export type HueUnit = '' | 'deg' | 'rad' | 'grad' | 'turn';

/**
 * How a colour was written, so a new colour is written back the same way.
 */
export interface ColourFormat {
  /**
   * Gets the family: hex, `rgb()` or `hsl()`. A named colour is written back as hex.
   */
  readonly family: ColourFamily;

  /**
   * Gets the quote the colour was written inside (a JSON string's), or empty for none.
   */
  readonly quote: string;

  /**
   * Gets whether the hex digits, or the function's name, were written in upper case.
   */
  readonly upperCase: boolean;

  /**
   * Gets whether a hex code was written short: `#rgb` or `#rgba`.
   */
  readonly short: boolean;

  /**
   * Gets whether the colour was written with an alpha: hex alpha digits, or a fourth argument.
   */
  readonly alphaWritten: boolean;

  /**
   * Gets the function's name as written, in lower case: `rgb`, `rgba`, `hsl` or `hsla`; empty for hex.
   */
  readonly functionName: string;

  /**
   * Gets whether the function was written in the modern space syntax (`rgb(255 0 0 / 50%)`) rather
   * than the legacy comma syntax (`rgba(255, 0, 0, 0.5)`).
   */
  readonly modern: boolean;

  /**
   * Gets whether an `rgb()` function's channels were written as percentages.
   */
  readonly percentChannels: boolean;

  /**
   * Gets whether the alpha was written as a percentage.
   */
  readonly alphaPercent: boolean;

  /**
   * Gets the unit an `hsl()` function's hue was written in.
   */
  readonly hueUnit: HueUnit;
}

/**
 * A colour read from text, and how it was written.
 */
export interface ParsedColour {
  /**
   * Gets the colour.
   */
  readonly colour: Rgba;

  /**
   * Gets how it was written.
   */
  readonly format: ColourFormat;
}

/**
 * Holds the CSS named colours (CSS Color Module Level 4), by lower-case name, as `#rrggbb`. The
 * `transparent` keyword is handled apart, since it has an alpha.
 */
export const NAMED_COLOURS: ReadonlyMap<string, string> = new Map<string, string>([
  ['aliceblue', '#f0f8ff'],
  ['antiquewhite', '#faebd7'],
  ['aqua', '#00ffff'],
  ['aquamarine', '#7fffd4'],
  ['azure', '#f0ffff'],
  ['beige', '#f5f5dc'],
  ['bisque', '#ffe4c4'],
  ['black', '#000000'],
  ['blanchedalmond', '#ffebcd'],
  ['blue', '#0000ff'],
  ['blueviolet', '#8a2be2'],
  ['brown', '#a52a2a'],
  ['burlywood', '#deb887'],
  ['cadetblue', '#5f9ea0'],
  ['chartreuse', '#7fff00'],
  ['chocolate', '#d2691e'],
  ['coral', '#ff7f50'],
  ['cornflowerblue', '#6495ed'],
  ['cornsilk', '#fff8dc'],
  ['crimson', '#dc143c'],
  ['cyan', '#00ffff'],
  ['darkblue', '#00008b'],
  ['darkcyan', '#008b8b'],
  ['darkgoldenrod', '#b8860b'],
  ['darkgray', '#a9a9a9'],
  ['darkgreen', '#006400'],
  ['darkgrey', '#a9a9a9'],
  ['darkkhaki', '#bdb76b'],
  ['darkmagenta', '#8b008b'],
  ['darkolivegreen', '#556b2f'],
  ['darkorange', '#ff8c00'],
  ['darkorchid', '#9932cc'],
  ['darkred', '#8b0000'],
  ['darksalmon', '#e9967a'],
  ['darkseagreen', '#8fbc8f'],
  ['darkslateblue', '#483d8b'],
  ['darkslategray', '#2f4f4f'],
  ['darkslategrey', '#2f4f4f'],
  ['darkturquoise', '#00ced1'],
  ['darkviolet', '#9400d3'],
  ['deeppink', '#ff1493'],
  ['deepskyblue', '#00bfff'],
  ['dimgray', '#696969'],
  ['dimgrey', '#696969'],
  ['dodgerblue', '#1e90ff'],
  ['firebrick', '#b22222'],
  ['floralwhite', '#fffaf0'],
  ['forestgreen', '#228b22'],
  ['fuchsia', '#ff00ff'],
  ['gainsboro', '#dcdcdc'],
  ['ghostwhite', '#f8f8ff'],
  ['gold', '#ffd700'],
  ['goldenrod', '#daa520'],
  ['gray', '#808080'],
  ['green', '#008000'],
  ['greenyellow', '#adff2f'],
  ['grey', '#808080'],
  ['honeydew', '#f0fff0'],
  ['hotpink', '#ff69b4'],
  ['indianred', '#cd5c5c'],
  ['indigo', '#4b0082'],
  ['ivory', '#fffff0'],
  ['khaki', '#f0e68c'],
  ['lavender', '#e6e6fa'],
  ['lavenderblush', '#fff0f5'],
  ['lawngreen', '#7cfc00'],
  ['lemonchiffon', '#fffacd'],
  ['lightblue', '#add8e6'],
  ['lightcoral', '#f08080'],
  ['lightcyan', '#e0ffff'],
  ['lightgoldenrodyellow', '#fafad2'],
  ['lightgray', '#d3d3d3'],
  ['lightgreen', '#90ee90'],
  ['lightgrey', '#d3d3d3'],
  ['lightpink', '#ffb6c1'],
  ['lightsalmon', '#ffa07a'],
  ['lightseagreen', '#20b2aa'],
  ['lightskyblue', '#87cefa'],
  ['lightslategray', '#778899'],
  ['lightslategrey', '#778899'],
  ['lightsteelblue', '#b0c4de'],
  ['lightyellow', '#ffffe0'],
  ['lime', '#00ff00'],
  ['limegreen', '#32cd32'],
  ['linen', '#faf0e6'],
  ['magenta', '#ff00ff'],
  ['maroon', '#800000'],
  ['mediumaquamarine', '#66cdaa'],
  ['mediumblue', '#0000cd'],
  ['mediumorchid', '#ba55d3'],
  ['mediumpurple', '#9370db'],
  ['mediumseagreen', '#3cb371'],
  ['mediumslateblue', '#7b68ee'],
  ['mediumspringgreen', '#00fa9a'],
  ['mediumturquoise', '#48d1cc'],
  ['mediumvioletred', '#c71585'],
  ['midnightblue', '#191970'],
  ['mintcream', '#f5fffa'],
  ['mistyrose', '#ffe4e1'],
  ['moccasin', '#ffe4b5'],
  ['navajowhite', '#ffdead'],
  ['navy', '#000080'],
  ['oldlace', '#fdf5e6'],
  ['olive', '#808000'],
  ['olivedrab', '#6b8e23'],
  ['orange', '#ffa500'],
  ['orangered', '#ff4500'],
  ['orchid', '#da70d6'],
  ['palegoldenrod', '#eee8aa'],
  ['palegreen', '#98fb98'],
  ['paleturquoise', '#afeeee'],
  ['palevioletred', '#db7093'],
  ['papayawhip', '#ffefd5'],
  ['peachpuff', '#ffdab9'],
  ['peru', '#cd853f'],
  ['pink', '#ffc0cb'],
  ['plum', '#dda0dd'],
  ['powderblue', '#b0e0e6'],
  ['purple', '#800080'],
  ['rebeccapurple', '#663399'],
  ['red', '#ff0000'],
  ['rosybrown', '#bc8f8f'],
  ['royalblue', '#4169e1'],
  ['saddlebrown', '#8b4513'],
  ['salmon', '#fa8072'],
  ['sandybrown', '#f4a460'],
  ['seagreen', '#2e8b57'],
  ['seashell', '#fff5ee'],
  ['sienna', '#a0522d'],
  ['silver', '#c0c0c0'],
  ['skyblue', '#87ceeb'],
  ['slateblue', '#6a5acd'],
  ['slategray', '#708090'],
  ['slategrey', '#708090'],
  ['snow', '#fffafa'],
  ['springgreen', '#00ff7f'],
  ['steelblue', '#4682b4'],
  ['tan', '#d2b48c'],
  ['teal', '#008080'],
  ['thistle', '#d8bfd8'],
  ['tomato', '#ff6347'],
  ['turquoise', '#40e0d0'],
  ['violet', '#ee82ee'],
  ['wheat', '#f5deb3'],
  ['white', '#ffffff'],
  ['whitesmoke', '#f5f5f5'],
  ['yellow', '#ffff00'],
  ['yellowgreen', '#9acd32'],
]);

/**
 * Holds the format a named colour is written back in: a lower-case long hex code.
 */
const NAMED_FORMAT: ColourFormat = {
  family: 'hex',
  quote: '',
  upperCase: false,
  short: false,
  alphaWritten: false,
  functionName: '',
  modern: false,
  percentChannels: false,
  alphaPercent: false,
  hueUnit: '',
};

/**
 * Matches a hex code's digits: three, four, six or eight.
 */
const HEX: RegExp = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * Matches a colour function and takes its name and its arguments.
 */
const FUNCTION: RegExp = /^(rgba?|hsla?)\(\s*([^()]*?)\s*\)$/i;

/**
 * Matches a number, CSS-style: an optional sign, digits with an optional fraction (or a bare fraction),
 * and an optional exponent, followed by an optional unit or percent sign.
 */
const NUMBER: RegExp = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(%|deg|rad|grad|turn)?$/i;

/**
 * Reads a CSS colour from text as written — `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`/`rgba()`
 * and `hsl()`/`hsla()` in the legacy comma syntax or the modern space syntax (with `/` before the
 * alpha), a named colour or `transparent` — optionally inside quotes, as a JSON string holds one.
 * @param text The text.
 * @returns Returns the colour and how it was written, or null when the text is not a colour this reads.
 */
export function parseColour(text: string): ParsedColour | null {
  const trimmed: string = text.trim();
  const quote: string = /^(["'])(.*)\1$/s.exec(trimmed)?.[1] ?? '';
  const body: string = quote === '' ? trimmed : trimmed.slice(1, -1).trim();
  const parsed: ParsedColour | null =
    parseHex(body) ?? parseFunction(body) ?? parseNamed(body.toLowerCase());
  return parsed === null ? null : { ...parsed, format: { ...parsed.format, quote } };
}

/**
 * Reads a hex code.
 * @param text The text, unquoted.
 * @returns Returns the colour and how it was written, or null when it is not a hex code.
 */
function parseHex(text: string): ParsedColour | null {
  const digits: string | undefined = HEX.exec(text)?.[1];
  if (digits === undefined) {
    return null;
  }
  const short: boolean = digits.length <= 4;
  const pairs: string[] = short
    ? [...digits].map((digit: string): string => digit + digit)
    : (digits.match(/../g) ?? []);
  const [red, green, blue, alpha] = pairs.map((pair: string): number => parseInt(pair, 16));
  return {
    colour: { red, green, blue, alpha: alpha === undefined ? 1 : alpha / 255 },
    format: {
      ...NAMED_FORMAT,
      upperCase: /[A-F]/.test(digits) && !/[a-f]/.test(digits),
      short,
      alphaWritten: pairs.length === 4,
    },
  };
}

/**
 * Reads a named colour, or `transparent`.
 * @param name The name, in lower case.
 * @returns Returns the colour, to be written back as hex, or null when it is not a name.
 */
function parseNamed(name: string): ParsedColour | null {
  if (name === 'transparent') {
    return { colour: { red: 0, green: 0, blue: 0, alpha: 0 }, format: NAMED_FORMAT };
  }
  const hex: string | undefined = NAMED_COLOURS.get(name);
  const parsed: ParsedColour | null = hex === undefined ? null : parseHex(hex);
  return parsed === null ? null : { colour: parsed.colour, format: NAMED_FORMAT };
}

/**
 * One argument of a colour function: its number and its unit (`%`, a hue unit, or empty).
 */
interface Argument {
  /**
   * Gets the number.
   */
  readonly value: number;

  /**
   * Gets the unit, in lower case: `%`, `deg`, `rad`, `grad`, `turn`, or empty.
   */
  readonly unit: string;
}

/**
 * Reads an `rgb()`, `rgba()`, `hsl()` or `hsla()` function.
 * @param text The text, unquoted.
 * @returns Returns the colour and how it was written, or null when it is not such a function or its
 * arguments do not read.
 */
function parseFunction(text: string): ParsedColour | null {
  const match: RegExpExecArray | null = FUNCTION.exec(text);
  if (match === null) {
    return null;
  }
  const written: string = match[1];
  const name: string = written.toLowerCase();
  const inside: string = match[2];
  const modern: boolean = !inside.includes(',');
  let parts: string[];
  let alphaPart: string | undefined;
  if (modern) {
    const [channels, alpha, ...rest] = inside.split('/');
    if (rest.length > 0) {
      return null;
    }
    parts = channels.trim().split(/\s+/);
    alphaPart = alpha?.trim();
  } else {
    parts = inside.split(',').map((part: string): string => part.trim());
    alphaPart = parts.length === 4 ? parts.pop() : undefined;
  }
  if (parts.length !== 3 || alphaPart === '') {
    return null;
  }
  const args: (Argument | null)[] = parts.map(readArgument);
  const alphaArg: Argument | null = alphaPart === undefined ? null : readArgument(alphaPart);
  if (
    args.some((arg: Argument | null): boolean => arg === null) ||
    (alphaPart !== undefined && (alphaArg === null || !['', '%'].includes(alphaArg.unit)))
  ) {
    return null;
  }
  const [first, second, third] = args as Argument[];
  const alpha: number =
    alphaArg === null ? 1 : clamp(alphaArg.unit === '%' ? alphaArg.value / 100 : alphaArg.value, 1);
  const base: Omit<ColourFormat, 'family' | 'percentChannels' | 'hueUnit'> = {
    quote: '',
    upperCase: written === written.toUpperCase(),
    short: false,
    alphaWritten: alphaArg !== null,
    functionName: name,
    modern,
    alphaPercent: alphaArg?.unit === '%',
  };
  if (name.startsWith('rgb')) {
    if (
      [first, second, third].some((arg: Argument): boolean => arg.unit !== '' && arg.unit !== '%')
    ) {
      return null;
    }
    const channel: (arg: Argument) => number = (arg: Argument): number =>
      clamp(arg.unit === '%' ? (arg.value / 100) * 255 : arg.value, 255);
    return {
      colour: { red: channel(first), green: channel(second), blue: channel(third), alpha },
      format: { ...base, family: 'rgb', percentChannels: first.unit === '%', hueUnit: '' },
    };
  }
  const hue: number | null = toDegrees(first);
  // Saturation and lightness are percentages; the modern syntax also takes bare numbers.
  const percent: (arg: Argument) => number | null = (arg: Argument): number | null =>
    arg.unit === '%' || (modern && arg.unit === '') ? clamp(arg.value, 100) : null;
  const saturation: number | null = percent(second);
  const lightness: number | null = percent(third);
  if (hue === null || saturation === null || lightness === null) {
    return null;
  }
  return {
    colour: hslToRgb({ hue, saturation, lightness, alpha }),
    format: {
      ...base,
      family: 'hsl',
      percentChannels: false,
      hueUnit: first.unit as HueUnit,
    },
  };
}

/**
 * Reads one argument of a colour function.
 * @param text The argument's text.
 * @returns Returns its number and unit, or null when it is not a number.
 */
function readArgument(text: string): Argument | null {
  const match: RegExpExecArray | null = NUMBER.exec(text);
  return match === null ? null : { value: Number(match[1]), unit: (match[2] ?? '').toLowerCase() };
}

/**
 * Turns a hue argument into degrees, 0 up to 360.
 * @param arg The argument.
 * @returns Returns the hue, or null when its unit is not an angle's.
 */
function toDegrees(arg: Argument): number | null {
  const factor: number | undefined = {
    '': 1,
    deg: 1,
    rad: 180 / Math.PI,
    grad: 0.9,
    turn: 360,
  }[arg.unit];
  return factor === undefined ? null : normaliseHue(arg.value * factor);
}

/**
 * Writes a colour as a format says: a hex code keeps its case, its shortness (where the colour allows
 * it) and its alpha digits (added where the colour is not opaque); a function keeps its name, syntax,
 * percentages and hue unit, gaining an alpha (and, in the legacy syntax, the `a` in its name) where
 * the colour is not opaque. A quoted colour stays quoted.
 * @param colour The colour.
 * @param format How to write it.
 * @returns Returns the text.
 */
export function formatColour(colour: Rgba, format: ColourFormat): string {
  const text: string =
    format.family === 'hex'
      ? formatHex(colour, format)
      : format.family === 'rgb'
        ? formatRgb(colour, format)
        : formatHsl(colour, format);
  return `${format.quote}${text}${format.quote}`;
}

/**
 * Writes a colour as a hex code.
 * @param colour The colour.
 * @param format How the code was written.
 * @returns Returns the code.
 */
function formatHex(colour: Rgba, format: ColourFormat): string {
  const bytes: number[] = [colour.red, colour.green, colour.blue].map((channel: number): number =>
    Math.round(clamp(channel, 255)),
  );
  const alpha: number = Math.round(clamp(colour.alpha, 1) * 255);
  if (format.alphaWritten || alpha < 255) {
    bytes.push(alpha);
  }
  const pairs: string[] = bytes.map((byte: number): string => byte.toString(16).padStart(2, '0'));
  const shortens: boolean =
    format.short && pairs.every((pair: string): boolean => /^(.)\1$/.test(pair));
  const digits: string = shortens
    ? pairs.map((pair: string): string => pair[0]).join('')
    : pairs.join('');
  return `#${format.upperCase ? digits.toUpperCase() : digits}`;
}

/**
 * Writes a colour as an `rgb()` or `rgba()` function.
 * @param colour The colour.
 * @param format How the function was written.
 * @returns Returns the function.
 */
function formatRgb(colour: Rgba, format: ColourFormat): string {
  const channels: string[] = [colour.red, colour.green, colour.blue].map(
    (channel: number): string =>
      format.percentChannels
        ? `${formatNumber((clamp(channel, 255) / 255) * 100, 1)}%`
        : formatNumber(clamp(channel, 255), 0),
  );
  return formatFunction('rgb', channels, colour.alpha, format);
}

/**
 * Writes a colour as an `hsl()` or `hsla()` function.
 * @param colour The colour.
 * @param format How the function was written.
 * @returns Returns the function.
 */
function formatHsl(colour: Rgba, format: ColourFormat): string {
  const hsl: Hsla = rgbToHsl(colour);
  const hue: string = {
    '': formatNumber(hsl.hue, 0),
    deg: `${formatNumber(hsl.hue, 0)}deg`,
    rad: `${formatNumber((hsl.hue * Math.PI) / 180, 4)}rad`,
    grad: `${formatNumber(hsl.hue / 0.9, 1)}grad`,
    turn: `${formatNumber(hsl.hue / 360, 4)}turn`,
  }[format.hueUnit];
  return formatFunction(
    'hsl',
    [hue, `${formatNumber(hsl.saturation, 0)}%`, `${formatNumber(hsl.lightness, 0)}%`],
    colour.alpha,
    format,
  );
}

/**
 * Writes a colour function from its channel arguments, in the format's syntax.
 * @param family The function's family: `rgb` or `hsl`.
 * @param channels The three channel arguments, as text.
 * @param alpha The alpha, 0–1.
 * @param format How the function was written.
 * @returns Returns the function.
 */
function formatFunction(
  family: 'rgb' | 'hsl',
  channels: readonly string[],
  alpha: number,
  format: ColourFormat,
): string {
  const withAlpha: boolean = format.alphaWritten || clamp(alpha, 1) < 1;
  const alphaText: string = format.alphaPercent
    ? `${formatNumber(clamp(alpha, 1) * 100, 0)}%`
    : formatNumber(clamp(alpha, 1), 2);
  let name: string = format.functionName === '' ? family : format.functionName;
  let text: string;
  if (format.modern) {
    text = `${channels.join(' ')}${withAlpha ? ` / ${alphaText}` : ''}`;
  } else {
    // The legacy syntax names a function with an alpha `rgba` or `hsla`; one written with the `a` keeps
    // it, even when the new colour is opaque.
    if (withAlpha && !name.endsWith('a')) {
      name = `${name}a`;
    }
    text = [...channels, ...(withAlpha ? [alphaText] : [])].join(', ');
  }
  return `${format.upperCase ? name.toUpperCase() : name}(${text})`;
}

/**
 * Gets the format a colour is written in when the format switcher picks a family: the way it was
 * written, when the family is the one it was written in; otherwise the family's plain form — a
 * lower-case long hex code, or a legacy comma-syntax function — keeping the quote it was written in.
 * @param family The family picked.
 * @param written How the colour was written.
 * @returns Returns the format.
 */
export function formatForFamily(family: ColourFamily, written: ColourFormat): ColourFormat {
  if (family === written.family) {
    return written;
  }
  return { ...NAMED_FORMAT, quote: written.quote, family };
}

/**
 * Converts a colour from red, green and blue to hue, saturation and lightness.
 * @param colour The colour.
 * @param fallbackHue The hue to give a grey, which has none of its own; 0 when omitted.
 * @returns Returns the colour as HSL.
 */
export function rgbToHsl(colour: Rgba, fallbackHue: number = 0): Hsla {
  const red: number = clamp(colour.red, 255) / 255;
  const green: number = clamp(colour.green, 255) / 255;
  const blue: number = clamp(colour.blue, 255) / 255;
  const max: number = Math.max(red, green, blue);
  const min: number = Math.min(red, green, blue);
  const lightness: number = (max + min) / 2;
  const delta: number = max - min;
  const saturation: number = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  return {
    hue: delta === 0 ? fallbackHue : hueOf(red, green, blue, max, delta),
    saturation: saturation * 100,
    lightness: lightness * 100,
    alpha: colour.alpha,
  };
}

/**
 * Converts a colour from hue, saturation and lightness to red, green and blue.
 * @param colour The colour.
 * @returns Returns the colour as RGB.
 */
export function hslToRgb(colour: Hsla): Rgba {
  const saturation: number = clamp(colour.saturation, 100) / 100;
  const lightness: number = clamp(colour.lightness, 100) / 100;
  const chroma: number = (1 - Math.abs(2 * lightness - 1)) * saturation;
  return fromChroma(normaliseHue(colour.hue), chroma, lightness - chroma / 2, colour.alpha);
}

/**
 * Converts a colour from red, green and blue to hue, saturation and value.
 * @param colour The colour.
 * @param fallbackHue The hue to give a grey, which has none of its own; 0 when omitted.
 * @returns Returns the colour as HSV.
 */
export function rgbToHsv(colour: Rgba, fallbackHue: number = 0): Hsva {
  const red: number = clamp(colour.red, 255) / 255;
  const green: number = clamp(colour.green, 255) / 255;
  const blue: number = clamp(colour.blue, 255) / 255;
  const max: number = Math.max(red, green, blue);
  const delta: number = max - Math.min(red, green, blue);
  return {
    hue: delta === 0 ? fallbackHue : hueOf(red, green, blue, max, delta),
    saturation: max === 0 ? 0 : (delta / max) * 100,
    value: max * 100,
    alpha: colour.alpha,
  };
}

/**
 * Converts a colour from hue, saturation and value to red, green and blue.
 * @param colour The colour.
 * @returns Returns the colour as RGB.
 */
export function hsvToRgb(colour: Hsva): Rgba {
  const value: number = clamp(colour.value, 100) / 100;
  const chroma: number = value * (clamp(colour.saturation, 100) / 100);
  return fromChroma(normaliseHue(colour.hue), chroma, value - chroma, colour.alpha);
}

/**
 * Converts a colour from hue, saturation and value to hue, saturation and lightness, keeping its hue.
 * @param colour The colour.
 * @returns Returns the colour as HSL.
 */
export function hsvToHsl(colour: Hsva): Hsla {
  const value: number = clamp(colour.value, 100) / 100;
  const lightness: number = value * (1 - clamp(colour.saturation, 100) / 200);
  const saturation: number =
    lightness === 0 || lightness === 1
      ? 0
      : (value - lightness) / Math.min(lightness, 1 - lightness);
  return {
    hue: colour.hue,
    saturation: saturation * 100,
    lightness: lightness * 100,
    alpha: colour.alpha,
  };
}

/**
 * Converts a colour from hue, saturation and lightness to hue, saturation and value, keeping its hue.
 * @param colour The colour.
 * @returns Returns the colour as HSV.
 */
export function hslToHsv(colour: Hsla): Hsva {
  const lightness: number = clamp(colour.lightness, 100) / 100;
  const value: number =
    lightness + (clamp(colour.saturation, 100) / 100) * Math.min(lightness, 1 - lightness);
  return {
    hue: colour.hue,
    saturation: value === 0 ? 0 : 2 * (1 - lightness / value) * 100,
    value: value * 100,
    alpha: colour.alpha,
  };
}

/**
 * Writes a colour as a CSS colour the browser draws: `rgb(r g b / a)`, for swatches and gradients.
 * @param colour The colour.
 * @returns Returns the CSS colour.
 */
export function cssColour(colour: Rgba): string {
  return formatColour(colour, {
    ...NAMED_FORMAT,
    family: 'rgb',
    functionName: 'rgb',
    modern: true,
    alphaWritten: true,
  });
}

/**
 * Writes a colour as a hex code: `#rrggbb`, or `#rrggbbaa` when it is not opaque.
 * @param colour The colour.
 * @returns Returns the code.
 */
export function hexColour(colour: Rgba): string {
  return formatHex(colour, NAMED_FORMAT);
}

/**
 * Determines whether two colours are the same once written: the same channel bytes and alpha byte.
 * @param first One colour.
 * @param second The other.
 * @returns Returns true when they are.
 */
export function sameColour(first: Rgba, second: Rgba): boolean {
  return hexColour(first) === hexColour(second);
}

/**
 * Brings a hue into 0 up to 360 degrees.
 * @param hue The hue, in degrees, any size or sign.
 * @returns Returns the hue.
 */
export function normaliseHue(hue: number): number {
  const turned: number = hue % 360;
  return turned < 0 ? turned + 360 : turned;
}

/**
 * Works out the hue of a colour from its channels.
 * @param red The red channel, 0–1.
 * @param green The green channel, 0–1.
 * @param blue The blue channel, 0–1.
 * @param max The largest channel.
 * @param delta The largest channel less the smallest; not zero.
 * @returns Returns the hue in degrees, 0 up to 360.
 */
function hueOf(red: number, green: number, blue: number, max: number, delta: number): number {
  const sextant: number =
    max === red
      ? (green - blue) / delta
      : max === green
        ? (blue - red) / delta + 2
        : (red - green) / delta + 4;
  return normaliseHue(sextant * 60);
}

/**
 * Builds a colour from its hue, chroma and the amount added to every channel.
 * @param hue The hue, 0 up to 360.
 * @param chroma The chroma, 0–1.
 * @param match The amount added to each channel, 0–1.
 * @param alpha The alpha, 0–1.
 * @returns Returns the colour as RGB.
 */
function fromChroma(hue: number, chroma: number, match: number, alpha: number): Rgba {
  const sextant: number = hue / 60;
  const second: number = chroma * (1 - Math.abs((sextant % 2) - 1));
  const [red, green, blue]: readonly number[] =
    sextant < 1
      ? [chroma, second, 0]
      : sextant < 2
        ? [second, chroma, 0]
        : sextant < 3
          ? [0, chroma, second]
          : sextant < 4
            ? [0, second, chroma]
            : sextant < 5
              ? [second, 0, chroma]
              : [chroma, 0, second];
  return {
    red: (red + match) * 255,
    green: (green + match) * 255,
    blue: (blue + match) * 255,
    alpha: clamp(alpha, 1),
  };
}

/**
 * Clamps a number into 0 up to a maximum.
 * @param value The number.
 * @param max The maximum.
 * @returns Returns the number, clamped.
 */
function clamp(value: number, max: number): number {
  return Math.min(max, Math.max(0, value));
}

/**
 * Writes a number rounded to some decimal places, without trailing zeros.
 * @param value The number.
 * @param decimals The decimal places.
 * @returns Returns the text.
 */
function formatNumber(value: number, decimals: number): string {
  const rounded: number = Number(value.toFixed(decimals));
  return String(Object.is(rounded, -0) ? 0 : rounded);
}
