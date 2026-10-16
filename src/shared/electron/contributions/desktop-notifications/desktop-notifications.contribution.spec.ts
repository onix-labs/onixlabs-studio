import { describe, expect, it, vi } from 'vitest';
import type { IpcMainEvent } from 'electron';
import { DesktopNotificationChannel } from '@shared/api/desktop-notification-channels';
import type { ContributionContext, ContributionListener } from '../main-contribution';

const state: { focused: boolean; shown: string[]; click?: () => void } = {
  focused: false,
  shown: [],
};

vi.mock('electron', () => ({
  BrowserWindow: { getFocusedWindow: (): unknown => (state.focused ? {} : null) },
  Notification: class {
    public static isSupported(): boolean {
      return true;
    }
    private readonly title: string;
    public constructor(options: { title: string }) {
      this.title = options.title;
    }
    public on(event: string, listener: () => void): void {
      if (event === 'click') {
        state.click = listener;
      }
    }
    public show(): void {
      state.shown.push(this.title);
    }
    public close(): void {
      return undefined;
    }
  },
}));

const { DesktopNotificationsContribution, readRequest } =
  await import('./desktop-notifications.contribution');

describe('DesktopNotificationsContribution', () => {
  it('showsOnlyWhileNoStudioWindowHasFocus_andAClickBringsStudioForward', () => {
    // #927: a user looking at Studio already sees the toast.
    let listener: ContributionListener | undefined;
    const sent: unknown[][] = [];
    const window: { isMinimized(): boolean; show: () => void; focus: ReturnType<typeof vi.fn> } = {
      isMinimized: (): boolean => false,
      show: (): void => undefined,
      focus: vi.fn(),
    };
    const context: ContributionContext = {
      on: (channel: string, handler: ContributionListener): void => {
        if ((channel as DesktopNotificationChannel) === DesktopNotificationChannel.Show) {
          listener = handler;
        }
      },
      send: (...args: unknown[]): void => void sent.push(args),
      mainWindow: (): unknown => window,
      log: { info: (): void => undefined },
    } as unknown as ContributionContext;
    new DesktopNotificationsContribution().activate(context);

    state.focused = true;
    listener?.({} as IpcMainEvent, { id: 1, title: 'Build failed' });
    expect(state.shown).toEqual([]);

    state.focused = false;
    listener?.({} as IpcMainEvent, { id: 2, title: 'Build failed' });
    expect(state.shown).toEqual(['Build failed']);

    state.click?.();
    expect(window.focus).toHaveBeenCalled();
    expect(sent).toEqual([[DesktopNotificationChannel.Clicked, 2]]);
  });

  it('readRequest_refusesWhatIsNotANotification', () => {
    expect(readRequest({ id: 1, title: '  ' })).toBeNull();
    expect(readRequest('x')).toBeNull();
    expect(readRequest({ id: 1, title: ' Done ', body: ' ' })).toEqual({ id: 1, title: 'Done' });
  });
});
