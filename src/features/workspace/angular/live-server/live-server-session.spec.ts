import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Bridge } from '@shared/api/bridge';
import {
  LiveServerAvailability,
  LiveServerChannel,
  LiveServerInfo,
  LiveServerOpenAnswer,
} from '@shared/api/live-server-channels';
import { PluginChannel } from '@shared/api/plugin-channels';
import { DirectoryListing } from '@shared/api/workspace-channels';
import { Notifications } from '@shared/angular/services/notifications/notifications';
import type { NotificationRequest } from '@shared/angular/services/notifications/notifications';
import { Shell } from '@shared/angular/services/shell/shell';
import { Workspace } from '@shared/angular/services/workspace/workspace';
import { LiveServerSession } from './live-server-session';

/**
 * The server the fake main process starts for the workspace.
 */
const SERVER: LiveServerInfo = {
  root: '/work/site',
  url: 'http://127.0.0.1:5500/',
  port: 5500,
  displayName: 'Live Server',
};

/**
 * Lets the session's start-up reads settle.
 * @returns Returns a promise that resolves once they have.
 */
async function settle(): Promise<void> {
  for (let turn: number = 0; turn < 5; turn += 1) {
    await Promise.resolve();
  }
}

describe('LiveServerSession (#1062)', () => {
  let invoked: { channel: string; args: unknown[] }[];
  let listeners: Map<string, (...args: unknown[]) => void>;
  let availability: LiveServerAvailability;
  let openAnswer: LiveServerOpenAnswer;
  let opened: { url: string; origin: string }[];
  let notified: NotificationRequest[];
  let root: WritableSignal<DirectoryListing | null>;

  beforeEach(() => {
    invoked = [];
    listeners = new Map<string, (...args: unknown[]) => void>();
    availability = 'ready';
    openAnswer = { ok: true, server: SERVER, pageUrl: 'http://127.0.0.1:5500/docs/a.html' };
    opened = [];
    notified = [];
    root = signal<DirectoryListing | null>({
      name: 'site',
      path: '/work/site',
    } as DirectoryListing);
    const bridge: Bridge = {
      invoke: <T>(channel: string, ...args: unknown[]): Promise<T> => {
        invoked.push({ channel, args });
        switch (channel) {
          case LiveServerChannel.Availability as string:
            return Promise.resolve(availability as T);
          case LiveServerChannel.List as string:
            return Promise.resolve([] as T);
          case LiveServerChannel.Open as string:
            return Promise.resolve(openAnswer as T);
          default:
            return Promise.resolve(undefined as T);
        }
      },
      send: (): void => undefined,
      on: (channel: string, listener: (...args: unknown[]) => void): (() => void) => {
        listeners.set(channel, listener);
        return (): void => {
          listeners.delete(channel);
        };
      },
    };
    (window as unknown as { bridge: Bridge }).bridge = bridge;
    TestBed.configureTestingModule({
      providers: [
        LiveServerSession,
        { provide: Workspace, useValue: { root } },
        {
          provide: Shell,
          useValue: {
            openExternal: (url: string, origin: string): Promise<void> => {
              opened.push({ url, origin });
              return Promise.resolve();
            },
          },
        },
        {
          provide: Notifications,
          useValue: {
            notify: (request: NotificationRequest): void => {
              notified.push(request);
            },
          },
        },
      ],
    });
  });

  afterEach(() => {
    delete (window as unknown as { bridge?: unknown }).bridge;
  });

  it('offers_itself_onHtmlPages_whenAPluginContributesALiveServer', async () => {
    const session: LiveServerSession = TestBed.inject(LiveServerSession);
    await settle();

    expect(session.opens('/work/site/index.html')).toBe(true);
    expect(session.opens('/work/site/About.HTM')).toBe(true);
    expect(session.opens('/work/site/site.css')).toBe(false);
  });

  it('offers_nothing_whenNoPluginContributesOne', async () => {
    availability = 'none';
    const session: LiveServerSession = TestBed.inject(LiveServerSession);
    await settle();

    expect(session.opens('/work/site/index.html')).toBe(false);
  });

  it('reads_availabilityAgain_whenPluginsChange', async () => {
    availability = 'none';
    const session: LiveServerSession = TestBed.inject(LiveServerSession);
    await settle();

    availability = 'not-installed';
    listeners.get(PluginChannel.Changed)?.();
    await settle();

    expect(session.opens('/work/site/index.html')).toBe(true);
  });

  it('opens_thePage_inTheBrowser_andShowsItsServer', async () => {
    const session: LiveServerSession = TestBed.inject(LiveServerSession);

    await session.open('/work/site/docs/a.html');

    expect(invoked).toContainEqual({
      channel: LiveServerChannel.Open,
      args: ['/work/site/docs/a.html'],
    });
    expect(opened).toEqual([{ url: 'http://127.0.0.1:5500/docs/a.html', origin: 'studio' }]);
    expect(session.server()).toEqual(SERVER);
  });

  it('reports_whyAPage_couldNotBeServed', async () => {
    openAnswer = { ok: false, error: 'Live Server is not installed — install it in Plugins.' };
    const session: LiveServerSession = TestBed.inject(LiveServerSession);

    await session.open('/work/site/index.html');

    expect(opened).toEqual([]);
    expect(notified).toEqual([
      expect.objectContaining({
        severity: 'error',
        detail: 'Live Server is not installed — install it in Plugins.',
      }),
    ]);
  });

  it('follows_theServersTheMainProcessAnnounces_forThisWorkspaceOnly', async () => {
    const session: LiveServerSession = TestBed.inject(LiveServerSession);
    await settle();

    listeners.get(LiveServerChannel.Changed)?.([
      { ...SERVER, root: '/work/other', port: 5501 },
      'not a server',
    ]);
    expect(session.server()).toBeNull();

    listeners.get(LiveServerChannel.Changed)?.([SERVER]);
    expect(session.server()).toEqual(SERVER);
  });

  it('opens_theAddressAgain', async () => {
    const session: LiveServerSession = TestBed.inject(LiveServerSession);
    listeners.get(LiveServerChannel.Changed)?.([SERVER]);

    await session.openAddress();

    expect(opened).toEqual([{ url: SERVER.url, origin: 'studio' }]);
  });

  it('stops_theServer_andForgetsIt', async () => {
    const session: LiveServerSession = TestBed.inject(LiveServerSession);
    listeners.get(LiveServerChannel.Changed)?.([SERVER]);

    await session.stop();

    expect(invoked).toContainEqual({ channel: LiveServerChannel.Stop, args: ['/work/site'] });
    expect(session.server()).toBeNull();
  });

  it('stops_theServer_whenTheTabCloses', async () => {
    const session: LiveServerSession = TestBed.inject(LiveServerSession);
    listeners.get(LiveServerChannel.Changed)?.([SERVER]);

    session.ngOnDestroy();
    await settle();

    expect(invoked).toContainEqual({ channel: LiveServerChannel.Stop, args: ['/work/site'] });
    expect(listeners.has(LiveServerChannel.Changed)).toBe(false);
  });

  it('copies_theAddress', async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string): Promise<void> => {
          written.push(text);
          return Promise.resolve();
        },
      },
    });
    const session: LiveServerSession = TestBed.inject(LiveServerSession);
    listeners.get(LiveServerChannel.Changed)?.([SERVER]);

    await session.copyAddress();

    expect(written).toEqual([SERVER.url]);
  });
});
