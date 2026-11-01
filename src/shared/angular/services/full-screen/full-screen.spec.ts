import { TestBed } from '@angular/core/testing';
import type { Bridge } from '@shared/api/bridge';
import { WindowChannel } from '@shared/api/window-channels';
import { FullScreen } from './full-screen';

describe('FullScreen', () => {
  let report: (fullScreen: unknown) => void;

  beforeEach(() => {
    const bridge: Bridge = {
      invoke: <T>(): Promise<T> => Promise.resolve(undefined as T),
      send: (): void => undefined,
      on: (channel: string, listener: (...args: unknown[]) => void): (() => void) => {
        if (channel === (WindowChannel.FullScreenChanged as string)) {
          report = listener;
        }
        return (): void => undefined;
      },
    };
    (window as unknown as { bridge: Bridge }).bridge = bridge;
  });

  afterEach(() => {
    delete (window as unknown as { bridge?: unknown }).bridge;
    document.documentElement.removeAttribute('data-full-screen');
    TestBed.resetTestingModule();
  });

  it('report_entering_marksTheRoot_andLeaving_clearsIt', () => {
    const fullScreen: FullScreen = TestBed.inject(FullScreen);

    report(true);
    expect(fullScreen.active()).toBe(true);
    expect(document.documentElement.getAttribute('data-full-screen')).toBe('true');

    report(false);
    expect(fullScreen.active()).toBe(false);
    expect(document.documentElement.hasAttribute('data-full-screen')).toBe(false);
  });
});
