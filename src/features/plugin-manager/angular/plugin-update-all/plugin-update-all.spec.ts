import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { PluginSummary } from '@shared/api/plugin-channels';
import { Notification, Notifications } from '@shared/angular/services/notifications/notifications';
import { Plugins } from '@shared/angular/services/plugins/plugins';
import { PluginUpdateAll } from './plugin-update-all';

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

describe('PluginUpdateAll', () => {
  let known: WritableSignal<readonly PluginSummary[]>;
  let busy: WritableSignal<boolean>;
  let lastError: WritableSignal<string | null>;
  let asked: string[];
  let outcomes: Record<string, 'installed' | 'declined' | 'failed'>;
  let release: (() => void) | null;
  let updateAll: PluginUpdateAll;
  let notifications: Notifications;

  beforeEach(() => {
    known = signal<readonly PluginSummary[]>([]);
    busy = signal<boolean>(false);
    lastError = signal<string | null>(null);
    asked = [];
    outcomes = {};
    release = null;
    const fake: Partial<Plugins> = {
      plugins: known.asReadonly(),
      busy: busy.asReadonly(),
      error: lastError.asReadonly(),
      // The row's own path: consent first, then the install. Each outcome is the test's to choose,
      // and the error is set the way the real install records one.
      installWithConsent: async (id: string): Promise<'installed' | 'declined' | 'failed'> => {
        asked.push(id);
        if (id === 'slow') {
          await new Promise<void>((resolve: () => void): void => {
            release = resolve;
          });
        }
        const outcome: 'installed' | 'declined' | 'failed' = outcomes[id] ?? 'installed';
        lastError.set(outcome === 'failed' ? `${id} broke` : null);
        return outcome;
      },
    };
    TestBed.configureTestingModule({ providers: [{ provide: Plugins, useValue: fake }] });
    updateAll = TestBed.inject(PluginUpdateAll);
    notifications = TestBed.inject(Notifications);
  });

  /**
   * Gets the live failure notification, if any.
   * @returns Returns the notification, or undefined.
   */
  function failureNotice(): Notification | undefined {
    return notifications
      .toasts()
      .find((toast: Notification): boolean => toast.key === 'plugin-update-all-failed');
  }

  it('enabled_onlyWhenAtLeastOnePluginHasAnUpdate', () => {
    known.set([plugin('a', '1.0.0', '1.0.0'), plugin('b', null, '2.0.0')]);
    expect(updateAll.available()).toBe(0);
    expect(updateAll.enabled()).toBe(false);

    known.set([plugin('a', '1.0.0', '1.1.0'), plugin('b', null, '2.0.0')]);

    expect(updateAll.available()).toBe(1);
    expect(updateAll.enabled()).toBe(true);
  });

  it('enabled_isFalseWhileAnotherPluginOperationIsBusy', () => {
    known.set([plugin('a', '1.0.0', '1.1.0')]);

    busy.set(true);

    expect(updateAll.enabled()).toBe(false);
  });

  it('updateAll_updatesEveryPluginWithAnUpdate_andSkipsTheRest', async () => {
    known.set([
      plugin('a', '1.0.0', '1.1.0'),
      plugin('b', '2.0.0', '2.0.0'),
      plugin('c', null, '3.0.0'),
      plugin('d', '0.1.0', '0.2.0'),
    ]);

    await updateAll.updateAll();

    // Through the row's own consent path, in catalogue order; up-to-date and not-installed are left.
    expect(asked).toEqual(['a', 'd']);
    expect(failureNotice()).toBeUndefined();
  });

  it('updateAll_isDisabledWhileRunning_andIgnoresASecondPress', async () => {
    known.set([plugin('slow', '1.0.0', '1.1.0'), plugin('b', '1.0.0', '1.1.0')]);

    const run: Promise<void> = updateAll.updateAll();
    expect(updateAll.running()).toBe(true);
    expect(updateAll.enabled()).toBe(false);
    await updateAll.updateAll();
    release?.();
    await run;

    expect(asked).toEqual(['slow', 'b']);
    expect(updateAll.running()).toBe(false);
  });

  it('updateAll_carriesOnPastAFailure_andReportsEveryFailureTogether', async () => {
    known.set([
      plugin('a', '1.0.0', '1.1.0'),
      plugin('b', '1.0.0', '1.1.0'),
      plugin('c', '1.0.0', '1.1.0'),
    ]);
    outcomes = { a: 'failed', c: 'failed' };

    await updateAll.updateAll();

    expect(asked).toEqual(['a', 'b', 'c']);
    const notice: Notification | undefined = failureNotice();
    expect(notice?.severity).toBe('error');
    expect(notice?.title).toBe('2 plugins could not be updated');
    expect(notice?.detail).toBe('A: a broke\nC: c broke');
  });

  it('updateAll_skipsADeclinedPlugin_withoutCountingItAsAFailure', async () => {
    known.set([plugin('a', '1.0.0', '1.1.0'), plugin('b', '1.0.0', '1.1.0')]);
    outcomes = { a: 'declined' };

    await updateAll.updateAll();

    expect(asked).toEqual(['a', 'b']);
    expect(failureNotice()).toBeUndefined();
  });
});
