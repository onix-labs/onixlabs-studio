import { describe, it, expect } from 'vitest';
import { Icon } from '../icons/icon';

// Test the alert pattern regex
const ALERT_PATTERN: RegExp = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]$/i;

describe('GitHub Alert Plugin', () => {
  describe('ALERT_PATTERN regex', () => {
    it('should match [!NOTE]', () => {
      expect(ALERT_PATTERN.test('[!NOTE]')).toBe(true);
    });

    it('should match [!TIP]', () => {
      expect(ALERT_PATTERN.test('[!TIP]')).toBe(true);
    });

    it('should match [!IMPORTANT]', () => {
      expect(ALERT_PATTERN.test('[!IMPORTANT]')).toBe(true);
    });

    it('should match [!WARNING]', () => {
      expect(ALERT_PATTERN.test('[!WARNING]')).toBe(true);
    });

    it('should match [!CAUTION]', () => {
      expect(ALERT_PATTERN.test('[!CAUTION]')).toBe(true);
    });

    it('should be case-insensitive', () => {
      expect(ALERT_PATTERN.test('[!note]')).toBe(true);
      expect(ALERT_PATTERN.test('[!Note]')).toBe(true);
      expect(ALERT_PATTERN.test('[!TiP]')).toBe(true);
    });

    it('should not match invalid alert types', () => {
      expect(ALERT_PATTERN.test('[!INFO]')).toBe(false);
      expect(ALERT_PATTERN.test('[!DANGER]')).toBe(false);
      expect(ALERT_PATTERN.test('[!ERROR]')).toBe(false);
    });

    it('should not match malformed markers', () => {
      expect(ALERT_PATTERN.test('!NOTE')).toBe(false);
      expect(ALERT_PATTERN.test('[NOTE]')).toBe(false);
      expect(ALERT_PATTERN.test('[! NOTE]')).toBe(false);
      expect(ALERT_PATTERN.test('[!NOTE')).toBe(false);
      expect(ALERT_PATTERN.test('NOTE]')).toBe(false);
    });

    it('should not match markers with additional text', () => {
      expect(ALERT_PATTERN.test('[!NOTE] extra text')).toBe(false);
      expect(ALERT_PATTERN.test('prefix [!NOTE]')).toBe(false);
    });

    it('should extract the alert type from the match', () => {
      const match: RegExpExecArray | null = ALERT_PATTERN.exec('[!WARNING]');
      expect(match).not.toBeNull();
      expect(match?.[1]).toBe('WARNING');
    });
  });

  describe('Icon mapping', () => {
    const ALERT_ICONS: Record<string, Icon> = {
      note: Icon.INFO,
      tip: Icon.HINT,
      important: Icon.IMPORTANT,
      warning: Icon.WARNING,
      caution: Icon.CAUTION,
    };

    it('should have an icon for each alert type', () => {
      expect(ALERT_ICONS['note']).toBe(Icon.INFO);
      expect(ALERT_ICONS['tip']).toBe(Icon.HINT);
      expect(ALERT_ICONS['important']).toBe(Icon.IMPORTANT);
      expect(ALERT_ICONS['warning']).toBe(Icon.WARNING);
      expect(ALERT_ICONS['caution']).toBe(Icon.CAUTION);
    });

    it('should have exactly 5 alert types defined', () => {
      expect(Object.keys(ALERT_ICONS)).toHaveLength(5);
    });
  });
});
