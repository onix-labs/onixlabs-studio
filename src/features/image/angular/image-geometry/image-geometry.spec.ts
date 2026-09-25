import { describe, expect, it } from 'vitest';
import {
  clampEdge,
  clampZoom,
  fitScale,
  formatFileSize,
  formatZoom,
  ImageRect,
  isUsefulCrop,
  MAX_EDGE,
  MAX_ZOOM,
  MIN_ZOOM,
  rectBetween,
  resizeKeepingAspect,
  scaleByPercent,
  sizeAfter,
  zoomInFrom,
  zoomOutFrom,
} from './image-geometry';

describe('image geometry', () => {
  it('fitScale_whenImageIsLargerThanTheViewport_shrinksItToFitTheTighterEdge', () => {
    expect(fitScale({ width: 2000, height: 1000 }, { width: 1000, height: 1000 })).toBe(0.5);
    expect(fitScale({ width: 1000, height: 4000 }, { width: 1000, height: 1000 })).toBe(0.25);
  });

  it('fitScale_whenImageIsSmallerThanTheViewport_showsItAtActualSize', () => {
    expect(fitScale({ width: 16, height: 16 }, { width: 1000, height: 800 })).toBe(1);
  });

  it('fitScale_whenEitherSizeIsEmpty_fallsBackToActualSize', () => {
    expect(fitScale({ width: 0, height: 0 }, { width: 100, height: 100 })).toBe(1);
    expect(fitScale({ width: 100, height: 100 }, { width: 0, height: 0 })).toBe(1);
  });

  it('clampZoom_keepsTheScaleWithinTheAllowedRange', () => {
    expect(clampZoom(0.0001)).toBe(MIN_ZOOM);
    expect(clampZoom(1000)).toBe(MAX_ZOOM);
    expect(clampZoom(2)).toBe(2);
  });

  it('zoomInFrom_stepsToTheNextStopAboveEvenFromBetweenStops', () => {
    expect(zoomInFrom(1)).toBe(1.25);
    expect(zoomInFrom(1.1)).toBe(1.25);
    expect(zoomInFrom(MAX_ZOOM)).toBe(MAX_ZOOM);
  });

  it('zoomOutFrom_stepsToTheNextStopBelowEvenFromBetweenStops', () => {
    expect(zoomOutFrom(1)).toBe(0.75);
    expect(zoomOutFrom(0.8)).toBe(0.75);
    expect(zoomOutFrom(0.01)).toBe(MIN_ZOOM);
  });

  it('sizeAfter_swapsEdgesOnRotateAndTakesTheCropOrResizeSize', () => {
    expect(sizeAfter({ width: 40, height: 30 }, { kind: 'rotate', clockwise: true })).toEqual({
      width: 30,
      height: 40,
    });
    expect(sizeAfter({ width: 40, height: 30 }, { kind: 'flip', axis: 'vertical' })).toEqual({
      width: 40,
      height: 30,
    });
    expect(
      sizeAfter(
        { width: 40, height: 30 },
        { kind: 'crop', rect: { x: 1, y: 2, width: 10, height: 5 } },
      ),
    ).toEqual({ width: 10, height: 5 });
    expect(sizeAfter({ width: 40, height: 30 }, { kind: 'resize', width: 8, height: 6 })).toEqual({
      width: 8,
      height: 6,
    });
  });

  it('rectBetween_normalisesADragInAnyDirectionAndClampsItToTheImage', () => {
    const rect: ImageRect = rectBetween(
      { x: 90.4, y: 70.6 },
      { x: -10, y: 20 },
      {
        width: 80,
        height: 60,
      },
    );
    expect(rect).toEqual({ x: 0, y: 20, width: 80, height: 40 });
  });

  it('isUsefulCrop_rejectsAnEmptyRectangleAndTheWholeImage', () => {
    const bounds: { width: number; height: number } = { width: 80, height: 60 };
    expect(isUsefulCrop({ x: 5, y: 5, width: 0, height: 10 }, bounds)).toBe(false);
    expect(isUsefulCrop({ x: 0, y: 0, width: 80, height: 60 }, bounds)).toBe(false);
    expect(isUsefulCrop({ x: 0, y: 0, width: 79, height: 60 }, bounds)).toBe(true);
  });

  it('resizeKeepingAspect_derivesTheOtherEdgeFromTheOneChanged', () => {
    expect(resizeKeepingAspect({ width: 400, height: 300 }, 'width', 200)).toEqual({
      width: 200,
      height: 150,
    });
    expect(resizeKeepingAspect({ width: 400, height: 300 }, 'height', 30)).toEqual({
      width: 40,
      height: 30,
    });
  });

  it('scaleByPercent_scalesBothEdgesAndNeverCollapsesBelowOnePixel', () => {
    expect(scaleByPercent({ width: 400, height: 300 }, 50)).toEqual({ width: 200, height: 150 });
    expect(scaleByPercent({ width: 4, height: 3 }, 1)).toEqual({ width: 1, height: 1 });
  });

  it('clampEdge_roundsAndBoundsAnEdgeLength', () => {
    expect(clampEdge(12.6)).toBe(13);
    expect(clampEdge(0)).toBe(1);
    expect(clampEdge(Number.NaN)).toBe(1);
    expect(clampEdge(MAX_EDGE * 2)).toBe(MAX_EDGE);
  });

  it('formatFileSize_usesBinaryUnits', () => {
    expect(formatFileSize(812)).toBe('812 B');
    expect(formatFileSize(12_698)).toBe('12 KB');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(3 * 1024 * 1024)).toBe('3.0 MB');
  });

  it('formatZoom_showsAWholePercentage', () => {
    expect(formatZoom(1)).toBe('100%');
    expect(formatZoom(1 / 3)).toBe('33%');
  });
});
