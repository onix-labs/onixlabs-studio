import { applyDevicePixel } from './device-pixel';

describe('applyDevicePixel', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('--device-pixel');
  });

  it('applyDevicePixel_atAFractionalScale_statesOneDevicePixelInCssPixels', () => {
    // 🔥 At 125% a device pixel is 0.8 CSS px. The tab feet are drawn in whole multiples of it, so
    // the browser has nothing left to round and every join meets exactly.
    vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(1.25);

    applyDevicePixel(window);

    expect(document.documentElement.style.getPropertyValue('--device-pixel')).toBe('0.8px');
  });

  it('applyDevicePixel_atAWholeScale_statesAWholeCssPixelFraction', () => {
    vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(2);

    applyDevicePixel(window);

    expect(document.documentElement.style.getPropertyValue('--device-pixel')).toBe('0.5px');
  });
});
