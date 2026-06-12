import { describe, it, expect } from 'vitest';
import { parseColor } from './color-preview-plugin';

describe('Color Preview Plugin', () => {
  describe('parseColor', () => {
    describe('hex colors', () => {
      it('should parse 3-digit hex colors', () => {
        expect(parseColor('#f00')).toBe('#f00');
        expect(parseColor('#0f0')).toBe('#0f0');
        expect(parseColor('#00f')).toBe('#00f');
      });

      it('should parse 6-digit hex colors', () => {
        expect(parseColor('#ff0000')).toBe('#ff0000');
        expect(parseColor('#00ff00')).toBe('#00ff00');
        expect(parseColor('#0000ff')).toBe('#0000ff');
      });

      it('should parse 4-digit hex colors (with alpha)', () => {
        expect(parseColor('#f00f')).toBe('#f00f');
        expect(parseColor('#0f08')).toBe('#0f08');
      });

      it('should parse 8-digit hex colors (with alpha)', () => {
        expect(parseColor('#ff0000ff')).toBe('#ff0000ff');
        expect(parseColor('#00ff0080')).toBe('#00ff0080');
      });

      it('should be case-insensitive', () => {
        expect(parseColor('#FF0000')).toBe('#FF0000');
        expect(parseColor('#aaBBcc')).toBe('#aaBBcc');
      });

      it('should reject invalid hex colors', () => {
        expect(parseColor('#ff')).toBe(null); // Too short
        expect(parseColor('#ff00')).toBe('#ff00'); // 4 digits is valid (with alpha)
        expect(parseColor('#ff000')).toBe(null); // 5 digits invalid
        expect(parseColor('#ff00000')).toBe(null); // 7 digits invalid
        expect(parseColor('#gggggg')).toBe(null); // Invalid characters
        expect(parseColor('ff0000')).toBe(null); // Missing #
      });
    });

    describe('rgb colors', () => {
      it('should parse valid rgb colors', () => {
        expect(parseColor('rgb(255, 0, 0)')).toBe('rgb(255, 0, 0)');
        expect(parseColor('rgb(0, 255, 0)')).toBe('rgb(0, 255, 0)');
        expect(parseColor('rgb(0, 0, 255)')).toBe('rgb(0, 0, 255)');
        expect(parseColor('rgb(128, 128, 128)')).toBe('rgb(128, 128, 128)');
      });

      it('should handle various spacing', () => {
        expect(parseColor('rgb(255,0,0)')).toBe('rgb(255, 0, 0)');
        expect(parseColor('rgb( 255 , 0 , 0 )')).toBe('rgb(255, 0, 0)');
      });

      it('should be case-insensitive', () => {
        expect(parseColor('RGB(255, 0, 0)')).toBe('rgb(255, 0, 0)');
        expect(parseColor('Rgb(255, 0, 0)')).toBe('rgb(255, 0, 0)');
      });

      it('should reject invalid rgb values', () => {
        expect(parseColor('rgb(256, 0, 0)')).toBe(null); // Value > 255
        expect(parseColor('rgb(-1, 0, 0)')).toBe(null); // Negative value
        expect(parseColor('rgb(255, 0)')).toBe(null); // Missing value
        expect(parseColor('rgb(255, 0, 0, 0.5)')).toBe(null); // Has alpha (should be rgba)
      });
    });

    describe('rgba colors', () => {
      it('should parse valid rgba colors', () => {
        expect(parseColor('rgba(255, 0, 0, 0.5)')).toBe('rgba(255, 0, 0, 0.5)');
        expect(parseColor('rgba(0, 255, 0, 1)')).toBe('rgba(0, 255, 0, 1)');
        expect(parseColor('rgba(0, 0, 255, 0)')).toBe('rgba(0, 0, 255, 0)');
      });

      it('should handle various spacing', () => {
        expect(parseColor('rgba(255,0,0,0.5)')).toBe('rgba(255, 0, 0, 0.5)');
        expect(parseColor('rgba( 255 , 0 , 0 , 0.5 )')).toBe('rgba(255, 0, 0, 0.5)');
      });

      it('should reject invalid alpha values', () => {
        expect(parseColor('rgba(255, 0, 0, 1.5)')).toBe(null); // Alpha > 1
        expect(parseColor('rgba(255, 0, 0, -0.1)')).toBe(null); // Negative alpha
      });
    });

    describe('hsl colors', () => {
      it('should parse valid hsl colors', () => {
        expect(parseColor('hsl(0, 100%, 50%)')).toBe('hsl(0, 100%, 50%)');
        expect(parseColor('hsl(120, 100%, 50%)')).toBe('hsl(120, 100%, 50%)');
        expect(parseColor('hsl(240, 100%, 50%)')).toBe('hsl(240, 100%, 50%)');
      });

      it('should handle various spacing', () => {
        expect(parseColor('hsl(0,100%,50%)')).toBe('hsl(0, 100%, 50%)');
        expect(parseColor('hsl( 0 , 100% , 50% )')).toBe('hsl(0, 100%, 50%)');
      });

      it('should be case-insensitive', () => {
        expect(parseColor('HSL(0, 100%, 50%)')).toBe('hsl(0, 100%, 50%)');
        expect(parseColor('Hsl(0, 100%, 50%)')).toBe('hsl(0, 100%, 50%)');
      });

      it('should reject invalid hsl values', () => {
        expect(parseColor('hsl(361, 100%, 50%)')).toBe(null); // Hue > 360
        expect(parseColor('hsl(0, 101%, 50%)')).toBe(null); // Saturation > 100
        expect(parseColor('hsl(0, 100%, 101%)')).toBe(null); // Lightness > 100
      });
    });

    describe('hsla colors', () => {
      it('should parse valid hsla colors', () => {
        expect(parseColor('hsla(0, 100%, 50%, 0.5)')).toBe('hsla(0, 100%, 50%, 0.5)');
        expect(parseColor('hsla(120, 100%, 50%, 1)')).toBe('hsla(120, 100%, 50%, 1)');
        expect(parseColor('hsla(240, 100%, 50%, 0)')).toBe('hsla(240, 100%, 50%, 0)');
      });

      it('should reject invalid alpha values', () => {
        expect(parseColor('hsla(0, 100%, 50%, 1.5)')).toBe(null); // Alpha > 1
        expect(parseColor('hsla(0, 100%, 50%, -0.1)')).toBe(null); // Negative alpha
      });
    });

    describe('non-color values', () => {
      it('should return null for non-color strings', () => {
        expect(parseColor('hello')).toBe(null);
        expect(parseColor('red')).toBe(null); // Named colors not supported
        expect(parseColor('')).toBe(null);
        expect(parseColor('123')).toBe(null);
        expect(parseColor('rgb')).toBe(null);
        expect(parseColor('hsl')).toBe(null);
      });
    });

    describe('whitespace handling', () => {
      it('should trim whitespace', () => {
        expect(parseColor('  #ff0000  ')).toBe('#ff0000');
        expect(parseColor('  rgb(255, 0, 0)  ')).toBe('rgb(255, 0, 0)');
      });
    });
  });
});
