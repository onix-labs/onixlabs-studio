import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bridge } from '@shared/api/bridge';
import { DesktopNotificationChannel } from '@shared/api/desktop-notification-channels';
import { Settings } from '@shared/angular/services/settings/settings';
import { DesktopNotifications } from './desktop-notifications';

describe('DesktopNotifications', () => {
  let sent: { channel: string; args: unknown[] }[];
  let clicked: ((...args: unknown[]) => void) | undefined;
  let saved: unknown;

  beforeEach(() => {
    sent = [];
    clicked = undefined;
    saved = (window as unknown as { bridge?: unknown }).bridge;
    const bridge: Bridge = {
      invoke: <T>(): Promise<T> => Promise.resolve(undefined as T),
      send: (channel: string, ...args: unknown[]): void => void sent.push({ channel, args }),
      on: (channel: string, listener: (...args: unknown[]) => void): (() => void) => {
        if ((channel as DesktopNotificationChannel) === DesktopNotificationChannel.Clicked) {
          clicked = listener;
        }
        return (): void => undefined;
      },
    };
    (window as unknown as { bridge: Bridge }).bridge = bridge;
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    (window as unknown as { bridge: unknown }).bridge = saved;
    localStorage.clear();
  });

  it('show_sendsTheNotification_andAClickBringsItsSubjectIntoView', () => {
    // #927.
    const desktop: DesktopNotifications = TestBed.inject(DesktopNotifications);
    const reveal: ReturnType<typeof vi.fn<() => void>> = vi.fn<() => void>();

    desktop.show('Agent finished — Fix the build', undefined, reveal);

    expect(sent).toEqual([
      {
        channel: DesktopNotificationChannel.Show,
        args: [{ id: 1, title: 'Agent finished — Fix the build' }],
      },
    ]);
    clicked?.(1);
    expect(reveal).toHaveBeenCalledTimes(1);
    clicked?.(99);
    expect(reveal).toHaveBeenCalledTimes(1);
  });

  it('show_sendsNothingWhenTheUserHasTurnedThemOff', () => {
    TestBed.inject(Settings).set('notifications.desktop', false);
    TestBed.inject(DesktopNotifications).show('Build failed');

    expect(sent).toEqual([]);
  });
});
