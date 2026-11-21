import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INTERFACE_ZOOM,
  INTERFACE_ZOOM_LEVELS,
  type InterfaceZoom,
  parseInterfaceZoom,
  zoomFactorOf,
} from './interface-zoom';

describe('interface zoom', () => {
  it('levels_areTheFixedSetRuledOn_smallestFirst', () => {
    expect(INTERFACE_ZOOM_LEVELS).toEqual([75, 80, 100, 125, 150, 200]);
    expect(DEFAULT_INTERFACE_ZOOM).toBe(100);
  });

  it.each([
    [75, 0.75],
    [80, 0.8],
    [100, 1],
    [125, 1.25],
    [150, 1.5],
    [200, 2],
  ])('zoomFactorOf_%s_is %s', (level: number, factor: number) => {
    expect(zoomFactorOf(level as InterfaceZoom)).toBe(factor);
  });

  it('parse_keepsEveryFixedLevel', () => {
    for (const level of INTERFACE_ZOOM_LEVELS) {
      expect(parseInterfaceZoom(level)).toBe(level);
    }
  });

  it.each([[90], [0], [-100], [1.25], ['125'], [null], [undefined], [{}]])(
    'parse_turnsAnythingElseIntoTheDefault %s',
    (candidate: unknown) => {
      expect(parseInterfaceZoom(candidate)).toBe(100);
    },
  );
});
