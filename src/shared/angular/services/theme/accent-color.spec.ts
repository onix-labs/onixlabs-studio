import {
  clampSaturation,
  CUSTOM_LIGHTNESS,
  hexToHsl,
  hexToRgb,
  hslToRgb,
  MAX_SATURATION,
  MIN_SATURATION,
  normaliseHue,
  rgbToHex,
  rgbToHsl,
  rgbToTriplet,
} from './accent-color';

describe('accent-color', () => {
  describe('normaliseHue', () => {
    it('normaliseHue_whenInRange_returnsUnchanged', () => {
      expect(normaliseHue(210)).toBe(210);
    });

    it('normaliseHue_whenNegative_wrapsIntoRange', () => {
      expect(normaliseHue(-30)).toBe(330);
    });

    it('normaliseHue_whenAtOrAboveThreeSixty_wraps', () => {
      expect(normaliseHue(360)).toBe(0);
      expect(normaliseHue(400)).toBe(40);
    });
  });

  describe('clampSaturation', () => {
    it('clampSaturation_whenBelowFloor_clampsToFloor', () => {
      expect(clampSaturation(0)).toBe(MIN_SATURATION);
    });

    it('clampSaturation_whenAboveCeiling_clampsToCeiling', () => {
      expect(clampSaturation(150)).toBe(MAX_SATURATION);
    });

    it('clampSaturation_whenWithinRange_roundsAndKeeps', () => {
      expect(clampSaturation(63.4)).toBe(63);
    });
  });

  describe('hexToRgb', () => {
    it('hexToRgb_whenSixDigit_parsesChannels', () => {
      expect(hexToRgb('#0D6EFD')).toEqual({ r: 13, g: 110, b: 253 });
    });

    it('hexToRgb_whenShorthand_expandsChannels', () => {
      expect(hexToRgb('#0f8')).toEqual({ r: 0, g: 255, b: 136 });
    });

    it('hexToRgb_whenMalformed_fallsBackToBlack', () => {
      expect(hexToRgb('nope')).toEqual({ r: 0, g: 0, b: 0 });
    });
  });

  describe('rgb formatting', () => {
    it('rgbToTriplet_formatsBareTriplet', () => {
      expect(rgbToTriplet({ r: 13, g: 110, b: 253 })).toBe('13, 110, 253');
    });

    it('rgbToHex_formatsHexAndClamps', () => {
      expect(rgbToHex({ r: 13, g: 110, b: 253 })).toBe('#0d6efd');
      expect(rgbToHex({ r: 300, g: -5, b: 128 })).toBe('#ff0080');
    });
  });

  describe('hsl conversions', () => {
    it('hslToRgb_whenZeroSaturation_returnsGrey', () => {
      expect(hslToRgb({ hue: 0, saturation: 0, lightness: 50 })).toEqual({
        r: 128,
        g: 128,
        b: 128,
      });
    });

    it('hslToRgb_whenSaturated_matchesKnownColour', () => {
      // hsl(210, 100%, 50%) is a pure azure blue.
      expect(hslToRgb({ hue: 210, saturation: 100, lightness: 50 })).toEqual({
        r: 0,
        g: 127,
        b: 255,
      });
    });

    it('rgbToHsl_and_hexToHsl_roundTripAKnownColour', () => {
      const hsl: { hue: number; saturation: number; lightness: number } = hexToHsl('#0080ff');
      expect(hsl.hue).toBe(210);
      expect(hsl.saturation).toBe(100);
      expect(hsl.lightness).toBe(50);
    });

    it('rgbToHsl_whenGrey_reportsZeroSaturation', () => {
      expect(rgbToHsl({ r: 128, g: 128, b: 128 }).saturation).toBe(0);
    });

    it('hslToRgb_atCustomLightness_isMidToned', () => {
      const rgb: { r: number; g: number; b: number } = hslToRgb({
        hue: 120,
        saturation: MAX_SATURATION,
        lightness: CUSTOM_LIGHTNESS,
      });
      expect(rgb).toEqual({ r: 0, g: 255, b: 0 });
    });
  });
});
