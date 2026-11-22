import { describe, expect, it } from 'vitest';
import { overlayHeightAt, trafficLightPositionAt } from './zoomed-chrome';

describe('zoomed chrome', () => {
  it.each([
    [0.75, 9],
    [0.8, 10],
    [1, 14],
    [1.25, 19],
    [1.5, 24],
    [2, 34],
  ])('trafficLights_at %s_stayCentredInTheStrip (y %s)', (factor: number, y: number) => {
    expect(trafficLightPositionAt(factor)).toEqual({ x: 14, y });
  });

  it('trafficLights_keepTheirInsetFromTheLeadingEdge_atEveryZoom', () => {
    expect(new Set([0.75, 1, 2].map((factor: number) => trafficLightPositionAt(factor).x))).toEqual(
      new Set([14]),
    );
  });

  it.each([
    [0.75, 30],
    [0.8, 32],
    [1, 40],
    [1.25, 50],
    [1.5, 60],
    [2, 80],
  ])('captionOverlay_at %s_fillsTheStrip (%s high)', (factor: number, height: number) => {
    expect(overlayHeightAt(factor)).toBe(height);
  });
});
