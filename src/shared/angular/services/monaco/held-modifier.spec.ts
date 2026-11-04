import { afterEach, describe, expect, it } from 'vitest';
import { watchHeldModifier } from './held-modifier';

describe('watchHeldModifier', () => {
  let stop: (() => void) | undefined;

  /**
   * Watches the window, on a platform, recording what is reported.
   * @param platform The platform.
   * @returns Returns the reports, oldest first.
   */
  function watch(platform: string): boolean[] {
    Object.defineProperty(window, 'host', { configurable: true, value: { platform } });
    const reports: boolean[] = [];
    stop = watchHeldModifier(window, (held: boolean): void => {
      reports.push(held);
    });
    return reports;
  }

  afterEach(() => {
    stop?.();
    Reflect.deleteProperty(window, 'host');
  });

  it('counts Option alone on macOS', () => {
    const reports: boolean[] = watch('darwin');

    window.dispatchEvent(new KeyboardEvent('keydown', { altKey: true }));
    window.dispatchEvent(new KeyboardEvent('keyup'));

    expect(reports).toEqual([true, false]);
  });

  it('wants Ctrl and Alt together elsewhere', () => {
    const reports: boolean[] = watch('win32');

    window.dispatchEvent(new KeyboardEvent('keydown', { altKey: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { altKey: true, ctrlKey: true }));

    expect(reports).toEqual([false, true]);
  });

  it('lets go when the window loses focus, which never hears the key come up', () => {
    const reports: boolean[] = watch('darwin');

    window.dispatchEvent(new KeyboardEvent('keydown', { altKey: true }));
    window.dispatchEvent(new Event('blur'));

    expect(reports).toEqual([true, false]);
  });
});
