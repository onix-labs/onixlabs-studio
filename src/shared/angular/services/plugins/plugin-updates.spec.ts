import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ApplicationRef } from '@angular/core';
import type { PluginSummary } from '@shared/api/plugin-channels';
import { Notification, Notifications } from '@shared/angular/services/notifications/notifications';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { Plugins } from './plugins';
import { PluginUpdates } from './plugin-updates';

/**
 * Builds a plugin summary.
 * @param id The plugin identifier.
 * @param installed The version on disk, or null when not installed.
 * @param offered The version the catalogue offers.
 * @returns Returns the summary.
 */
function plugin(id: string, installed: string | null, offered: string): PluginSummary {
  return {
    id,
    name: id.toUpperCase(),
    description: 'Test plugin.',
    state: installed === null ? 'available' : 'installed',
    version: offered,
    installedVersion: installed,
    detail: null,
    origin: null,
    contributions: [],
  } as unknown as PluginSummary;
}

describe('PluginUpdates', () => {
  let known: WritableSignal<readonly PluginSummary[]>;
  let updates: PluginUpdates;
  let notifications: Notifications;
  let opened: string[];

  beforeEach(() => {
    known = signal<readonly PluginSummary[]>([]);
    opened = [];
    TestBed.configureTestingModule({
      providers: [
        { provide: Plugins, useValue: { plugins: known.asReadonly() } },
        {
          provide: Tabs,
          useValue: { open: (type: string): void => void opened.push(type) },
        },
      ],
    });
    updates = TestBed.inject(PluginUpdates);
    notifications = TestBed.inject(Notifications);
  });

  /**
   * Runs pending effects.
   */
  function flush(): void {
    TestBed.inject(ApplicationRef).tick();
  }

  /**
   * Gets the live updates notification, if any.
   * @returns Returns the notification, or undefined.
   */
  function notice(): Notification | undefined {
    return notifications
      .toasts()
      .find((toast: Notification): boolean => toast.key === 'plugin-updates');
  }

  it('available_listsOnlyInstalledPluginsWithANewerVersion', () => {
    known.set([
      plugin('a', '1.0.0', '1.1.0'),
      plugin('b', '2.0.0', '2.0.0'),
      plugin('c', null, '3.0.0'),
    ]);

    expect(updates.available().map((item: PluginSummary): string => item.id)).toEqual(['a']);
  });

  it('nothingWaiting_raisesNothing', () => {
    known.set([plugin('a', '1.0.0', '1.0.0')]);
    flush();

    expect(notice()).toBeUndefined();
  });

  it('updatesWaiting_announcesThemWithVersions', () => {
    known.set([plugin('claude', '0.8.0', '0.10.0'), plugin('git', '0.3.0', '0.4.0')]);
    flush();

    expect(notice()?.title).toBe('2 plugin updates are available');
    expect(notice()?.detail).toBe('CLAUDE 0.8.0 → 0.10.0, GIT 0.3.0 → 0.4.0');
    expect(notice()?.sticky).toBe(true);
  });

  it('oneUpdate_isNamedInTheSingular', () => {
    known.set([plugin('claude', '0.8.0', '0.10.0')]);
    flush();

    expect(notice()?.title).toBe('A plugin update is available');
  });

  it('review_opensThePluginManager', () => {
    known.set([plugin('claude', '0.8.0', '0.10.0')]);
    flush();
    notice()
      ?.actions.find((action) => action.label === 'Review')
      ?.run();

    expect(opened).toEqual(['plugin-manager']);
  });

  it('theSameSet_isAnnouncedOnceASession', () => {
    known.set([plugin('claude', '0.8.0', '0.10.0')]);
    flush();
    notifications.dismissByKey('plugin-updates');
    known.set([plugin('claude', '0.8.0', '0.10.0')]);
    flush();

    expect(notice()).toBeUndefined();
  });

  it('aDifferentSet_isAnnouncedAfresh', () => {
    known.set([plugin('claude', '0.8.0', '0.10.0')]);
    flush();
    notifications.dismissByKey('plugin-updates');
    known.set([plugin('claude', '0.8.0', '0.11.0')]);
    flush();

    expect(notice()?.detail).toBe('CLAUDE 0.8.0 → 0.11.0');
  });

  it('everythingUpdated_withdrawsTheNotice', () => {
    known.set([plugin('claude', '0.8.0', '0.10.0')]);
    flush();
    known.set([plugin('claude', '0.10.0', '0.10.0')]);
    flush();

    expect(notice()).toBeUndefined();
  });
});
