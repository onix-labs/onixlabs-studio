import { accentSelectionHex } from './monaco-themes';

describe('monaco-themes', () => {
  describe('accentSelectionHex', () => {
    it('accentSelectionHex_whenWellFormedTriplet_returnsTranslucentHex', () => {
      expect(accentSelectionHex('59, 130, 246')).toBe('#3b82f659');
    });

    it('accentSelectionHex_clampsAndRoundsChannels', () => {
      expect(accentSelectionHex('0, 255, 300')).toBe('#00ffff59');
    });

    it('accentSelectionHex_whenMalformed_returnsNull', () => {
      expect(accentSelectionHex('')).toBeNull();
      expect(accentSelectionHex('59, 130')).toBeNull();
      expect(accentSelectionHex('59, 130, 246, 1')).toBeNull();
      expect(accentSelectionHex('59, x, 246')).toBeNull();
    });
  });
});
