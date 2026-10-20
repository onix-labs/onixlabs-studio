import {
  ColourFormat,
  cssColour,
  formatColour,
  formatForFamily,
  hexColour,
  hslToHsv,
  hslToRgb,
  hsvToHsl,
  hsvToRgb,
  NAMED_COLOURS,
  normaliseHue,
  parseColour,
  ParsedColour,
  Rgba,
  rgbToHsl,
  rgbToHsv,
  sameColour,
} from './colours';

/**
 * Reads a colour that must read.
 * @param text The text.
 * @returns Returns the colour and its format.
 */
function parsed(text: string): ParsedColour {
  const result: ParsedColour | null = parseColour(text);
  if (result === null) {
    throw new Error(`Did not read: ${text}`);
  }
  return result;
}

/**
 * Rounds a colour's channels, for comparing.
 * @param colour The colour.
 * @returns Returns the channels rounded, and the alpha to two places.
 */
function rounded(colour: Rgba): Rgba {
  return {
    red: Math.round(colour.red),
    green: Math.round(colour.green),
    blue: Math.round(colour.blue),
    alpha: Math.round(colour.alpha * 100) / 100,
  };
}

/**
 * A new colour, half-transparent green.
 */
const HALF_GREEN: Rgba = { red: 0, green: 255, blue: 0, alpha: 0.5 };

/**
 * A new colour, opaque blue.
 */
const BLUE: Rgba = { red: 0, green: 0, blue: 255, alpha: 1 };

describe('colours (#1025)', () => {
  describe('parseColour', () => {
    it.each([
      ['#fff', { red: 255, green: 255, blue: 255, alpha: 1 }],
      ['#ffff', { red: 255, green: 255, blue: 255, alpha: 1 }],
      ['#f008', { red: 255, green: 0, blue: 0, alpha: 0.53 }],
      ['#ff0000', { red: 255, green: 0, blue: 0, alpha: 1 }],
      ['#FF000080', { red: 255, green: 0, blue: 0, alpha: 0.5 }],
      ['rgb(255, 0, 0)', { red: 255, green: 0, blue: 0, alpha: 1 }],
      ['rgba(255,0,0,.5)', { red: 255, green: 0, blue: 0, alpha: 0.5 }],
      ['rgb(255 0 0 / 50%)', { red: 255, green: 0, blue: 0, alpha: 0.5 }],
      ['rgb(100% 0% 50%)', { red: 255, green: 0, blue: 128, alpha: 1 }],
      ['RGB(0, 128, 255)', { red: 0, green: 128, blue: 255, alpha: 1 }],
      ['hsl(120, 100%, 50%)', { red: 0, green: 255, blue: 0, alpha: 1 }],
      ['hsl(120deg 100% 50%)', { red: 0, green: 255, blue: 0, alpha: 1 }],
      ['hsl(0.5turn 100% 50% / 0.25)', { red: 0, green: 255, blue: 255, alpha: 0.25 }],
      ['hsla(240, 100%, 50%, 0.5)', { red: 0, green: 0, blue: 255, alpha: 0.5 }],
      ['hsl(-120 100% 50%)', { red: 0, green: 0, blue: 255, alpha: 1 }],
      ['hsl(200grad 100% 50%)', { red: 0, green: 255, blue: 255, alpha: 1 }],
      ['hsl(3.14159rad 100% 50%)', { red: 0, green: 255, blue: 255, alpha: 1 }],
      ['rebeccapurple', { red: 102, green: 51, blue: 153, alpha: 1 }],
      ['Red', { red: 255, green: 0, blue: 0, alpha: 1 }],
      ['transparent', { red: 0, green: 0, blue: 0, alpha: 0 }],
      ['"#00ff00"', { red: 0, green: 255, blue: 0, alpha: 1 }],
      ['rgb(300, -5, 0, 2)', { red: 255, green: 0, blue: 0, alpha: 1 }],
    ])('reads_%s', (text: string, colour: Rgba) => {
      expect(rounded(parsed(text).colour)).toEqual(colour);
    });

    it.each([
      '',
      '#ff',
      '#fffff',
      '#ggg',
      'rgb(255, 0)',
      'rgb(255 0 0 0)',
      'rgb(255, 0, 0, 0.5, 1)',
      'rgb(255 0 0 / 1 / 1)',
      'rgb(255 0 0 /)',
      'rgb(10deg 0 0)',
      'hsl(120, 100, 50)',
      'hsl(120% 50% 50%)',
      'rgb(none 0 0)',
      'rgb(255, 0, 0, 1deg)',
      'notacolour',
      'Color(1, 0, 0)',
    ])('readsNothingFrom_%s', (text: string) => {
      expect(parseColour(text)).toBeNull();
    });

    it('remembersHowEachWasWritten', () => {
      expect(parsed('#ABC').format).toMatchObject({ family: 'hex', short: true, upperCase: true });
      expect(parsed('#aabbccdd').format).toMatchObject({ short: false, alphaWritten: true });
      expect(parsed('rgba(1, 2, 3, 50%)').format).toMatchObject({
        family: 'rgb',
        functionName: 'rgba',
        modern: false,
        alphaWritten: true,
        alphaPercent: true,
      });
      expect(parsed('rgb(10% 20% 30%)').format).toMatchObject({
        modern: true,
        percentChannels: true,
      });
      expect(parsed('hsl(1turn 0% 0%)').format).toMatchObject({ family: 'hsl', hueUnit: 'turn' });
      expect(parsed("'red'").format).toMatchObject({ family: 'hex', quote: "'" });
    });

    it('holdsEveryNamedColour_asALongHexCode', () => {
      expect(NAMED_COLOURS.size).toBe(148);
      for (const [name, hex] of NAMED_COLOURS) {
        expect(/^#[0-9a-f]{6}$/.test(hex), name).toBe(true);
        expect(hexColour(parsed(name).colour)).toBe(hex);
      }
    });
  });

  describe('formatColour keeps the format as written', () => {
    it.each([
      ['#f00', BLUE, '#00f'],
      ['#f00', { red: 18, green: 52, blue: 86, alpha: 1 }, '#123456'],
      ['#F00', HALF_GREEN, '#00FF0080'],
      ['#f00f', BLUE, '#00ff'],
      ['#ff0000', BLUE, '#0000ff'],
      ['#ff0000', HALF_GREEN, '#00ff0080'],
      ['#ff000080', BLUE, '#0000ffff'],
      ['red', BLUE, '#0000ff'],
      ['red', HALF_GREEN, '#00ff0080'],
      ['transparent', BLUE, '#0000ff'],
      ['rgb(255, 0, 0)', BLUE, 'rgb(0, 0, 255)'],
      ['rgb(255, 0, 0)', HALF_GREEN, 'rgba(0, 255, 0, 0.5)'],
      ['rgba(255, 0, 0, 0.5)', BLUE, 'rgba(0, 0, 255, 1)'],
      ['rgba(255, 0, 0, 50%)', HALF_GREEN, 'rgba(0, 255, 0, 50%)'],
      ['rgb(255 0 0)', HALF_GREEN, 'rgb(0 255 0 / 0.5)'],
      ['rgb(255 0 0 / 50%)', BLUE, 'rgb(0 0 255 / 100%)'],
      ['rgb(100% 0% 0%)', { red: 0, green: 127.5, blue: 255, alpha: 1 }, 'rgb(0% 50% 100%)'],
      ['RGB(255, 0, 0)', BLUE, 'RGB(0, 0, 255)'],
      ['hsl(0, 100%, 50%)', BLUE, 'hsl(240, 100%, 50%)'],
      ['hsl(0, 100%, 50%)', HALF_GREEN, 'hsla(120, 100%, 50%, 0.5)'],
      ['hsla(0, 100%, 50%, 1)', BLUE, 'hsla(240, 100%, 50%, 1)'],
      ['hsl(0deg 100% 50%)', BLUE, 'hsl(240deg 100% 50%)'],
      ['hsl(0turn 100% 50%)', BLUE, 'hsl(0.6667turn 100% 50%)'],
      ['hsl(0 100% 50%)', HALF_GREEN, 'hsl(120 100% 50% / 0.5)'],
      ['"#ff0000"', BLUE, '"#0000ff"'],
    ])('%s_with_%o_writes_%s', (written: string, colour: Rgba, expected: string) => {
      expect(formatColour(colour, parsed(written).format)).toBe(expected);
    });

    it.each([
      '#abc',
      '#AABBCC',
      '#11223344',
      'rgb(12, 34, 56)',
      'rgba(12, 34, 56, 0.25)',
      'rgb(12 34 56 / 25%)',
      'hsl(210, 50%, 40%)',
      'hsl(210deg 50% 40% / 0.75)',
      'hsla(10, 20%, 30%, 0.4)',
    ])('roundTrips_%s_unchanged', (text: string) => {
      const { colour, format } = parsed(text);

      expect(formatColour(colour, format)).toBe(text);
    });
  });

  describe('formatForFamily', () => {
    it('keepsTheFormatAsWritten_forItsOwnFamily_andAPlainFormOtherwise_keepingTheQuote', () => {
      const written: ColourFormat = parsed('"rgb(255 0 0 / 50%)"').format;

      expect(formatForFamily('rgb', written)).toBe(written);
      expect(formatColour(HALF_GREEN, formatForFamily('hex', written))).toBe('"#00ff0080"');
      expect(formatColour(BLUE, formatForFamily('hsl', written))).toBe('"hsl(240, 100%, 50%)"');
      expect(formatColour(HALF_GREEN, formatForFamily('hsl', written))).toBe(
        '"hsla(120, 100%, 50%, 0.5)"',
      );
      expect(formatColour(BLUE, formatForFamily('rgb', parsed('#fff').format))).toBe(
        'rgb(0, 0, 255)',
      );
    });
  });

  describe('conversions', () => {
    it.each([
      [{ red: 255, green: 0, blue: 0, alpha: 1 }],
      [{ red: 12, green: 200, blue: 99, alpha: 0.3 }],
      [{ red: 0, green: 0, blue: 0, alpha: 1 }],
      [{ red: 255, green: 255, blue: 255, alpha: 1 }],
      [{ red: 128, green: 128, blue: 128, alpha: 1 }],
      [{ red: 250, green: 10, blue: 200, alpha: 0 }],
    ])('roundTripsThroughHslAndHsv_%o', (colour: Rgba) => {
      expect(rounded(hslToRgb(rgbToHsl(colour)))).toEqual(colour);
      expect(rounded(hsvToRgb(rgbToHsv(colour)))).toEqual(colour);
      expect(rounded(hsvToRgb(hslToHsv(hsvToHsl(rgbToHsv(colour)))))).toEqual(colour);
    });

    it('givesAGreyTheFallbackHue_andKeepsAHueBetweenHsvAndHsl', () => {
      const grey: Rgba = { red: 128, green: 128, blue: 128, alpha: 1 };

      expect(rgbToHsl(grey, 200).hue).toBe(200);
      expect(rgbToHsv(grey, 200).hue).toBe(200);
      expect(hsvToHsl({ hue: 77, saturation: 0, value: 0, alpha: 1 })).toEqual({
        hue: 77,
        saturation: 0,
        lightness: 0,
        alpha: 1,
      });
      expect(hslToHsv({ hue: 77, saturation: 50, lightness: 0, alpha: 1 }).hue).toBe(77);
    });

    it('normalisesHues', () => {
      expect(normaliseHue(360)).toBe(0);
      expect(normaliseHue(-90)).toBe(270);
      expect(normaliseHue(725)).toBe(5);
    });

    it('writesCssAndHex_andComparesWrittenColours', () => {
      expect(cssColour({ red: 255, green: 0, blue: 0, alpha: 0.5 })).toBe('rgb(255 0 0 / 0.5)');
      expect(hexColour({ red: 255, green: 0, blue: 0, alpha: 1 })).toBe('#ff0000');
      expect(hexColour({ red: 255, green: 0, blue: 0, alpha: 0 })).toBe('#ff000000');
      expect(sameColour(BLUE, { red: 0.2, green: 0, blue: 254.8, alpha: 1 })).toBe(true);
      expect(sameColour(BLUE, HALF_GREEN)).toBe(false);
    });
  });
});
