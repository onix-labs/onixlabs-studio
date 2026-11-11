import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { PluginSummary } from '@shared/api/plugin-channels';
import { Notification, Notifications } from '@shared/angular/services/notifications/notifications';
import { PluginConsent } from '@shared/angular/services/plugins/plugin-consent';
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

/**
 * Lets pending promise continuations run.
 * @returns Returns a promise that resolves on the next macrotask.
 */
function settle(): Promise<void> {
  return new Promise<void>((resolve: () => void): void => void setTimeout(resolve, 0));
}

describe('PluginUpdateAll', () => {
  let known: WritableSignal<readonly PluginSummary[]>;
  let busy: WritableSignal<boolean>;
  let lastError: WritableSignal<string | null>;
  let installed: string[];
  let perPluginAsks: number;
  let failing: Set<string>;
  let updateAll: PluginUpdateAll;
  let consent: PluginConsent;
  let notifications: Notifications;
  let batchesAsked: (readonly string[])[];

  beforeEach(() => {
    known = signal<readonly PluginSummary[]>([]);
    busy = signal<boolean>(false);
    lastError = signal<string | null>(null);
    installed = [];
    perPluginAsks = 0;
    failing = new Set<string>();
    batchesAsked = [];
    const fake: Partial<Plugins> = {
      plugins: known.asReadonly(),
      busy: busy.asReadonly(),
      error: lastError.asReadonly(),
      // The per-plugin consent path must never be taken by Update All.
      installWithConsent: (): Promise<'installed' | 'declined' | 'failed'> => {
        perPluginAsks += 1;
        return Promise.resolve('installed');
      },
      // The install after consent: records the error the way the real one does.
      install: (id: string): Promise<void> => {
        installed.push(id);
        lastError.set(failing.has(id) ? `${id} broke` : null);
        return Promise.resolve();
      },
    };
    TestBed.configureTestingModule({ providers: [{ provide: Plugins, useValue: fake }] });
    updateAll = TestBed.inject(PluginUpdateAll);
    consent = TestBed.inject(PluginConsent);
    notifications = TestBed.inject(Notifications);
    const requestBatch: PluginConsent['requestBatch'] = consent.requestBatch.bind(consent);
    vi.spyOn(consent, 'requestBatch').mockImplementation(
      (plugins: readonly PluginSummary[]): Promise<boolean> => {
        batchesAsked.push(plugins.map((item: PluginSummary): string => item.id));
        return requestBatch(plugins);
      },
    );
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

  /**
   * Starts Update All and answers its one question.
   * @param accept Whether to accept the batch's terms.
   * @returns Returns a promise that resolves once the run has finished.
   */
  async function runAnswering(accept: boolean): Promise<void> {
    const run: Promise<void> = updateAll.updateAll();
    await settle();
    if (accept) {
      consent.accept();
    } else {
      consent.decline();
    }
    await run;
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

  it('updateAll_asksOneWindowForEveryUpdate_listingFromAndToVersions', async () => {
    known.set([
      plugin('a', '1.0.0', '1.1.0'),
      plugin('b', '2.0.0', '2.0.0'),
      plugin('c', null, '3.0.0'),
      plugin('d', '0.1.0', '0.2.0'),
    ]);

    const run: Promise<void> = updateAll.updateAll();
    await settle();

    // One question, for the plugins with updates only, each carrying its before and after.
    expect(batchesAsked).toEqual([['a', 'd']]);
    expect(
      consent
        .pendingBatch()
        ?.map((item: PluginSummary): string => `${item.installedVersion} → ${item.version}`),
    ).toEqual(['1.0.0 → 1.1.0', '0.1.0 → 0.2.0']);
    expect(consent.pending()).toBeNull();
    consent.decline();
    await run;
  });

  it('updateAll_whenCancelled_updatesNothing', async () => {
    known.set([plugin('a', '1.0.0', '1.1.0'), plugin('b', '1.0.0', '1.1.0')]);

    await runAnswering(false);

    expect(installed).toEqual([]);
    expect(failureNotice()).toBeUndefined();
    expect(updateAll.running()).toBe(false);
  });

  it('updateAll_whenApproved_updatesEveryPluginWithNoPerPluginWindows', async () => {
    known.set([
      plugin('a', '1.0.0', '1.1.0'),
      plugin('b', '2.0.0', '2.0.0'),
      plugin('d', '0.1.0', '0.2.0'),
    ]);

    await runAnswering(true);

    expect(installed).toEqual(['a', 'd']);
    expect(perPluginAsks).toBe(0);
    expect(batchesAsked).toHaveLength(1);
    expect(failureNotice()).toBeUndefined();
  });

  it('updateAll_isDisabledWhileRunning_andIgnoresASecondPress', async () => {
    known.set([plugin('a', '1.0.0', '1.1.0')]);

    const run: Promise<void> = updateAll.updateAll();
    expect(updateAll.running()).toBe(true);
    expect(updateAll.enabled()).toBe(false);
    await updateAll.updateAll();
    await settle();
    consent.accept();
    await run;

    expect(batchesAsked).toHaveLength(1);
    expect(installed).toEqual(['a']);
    expect(updateAll.running()).toBe(false);
  });

  it('updateAll_carriesOnPastAFailure_andReportsEveryFailureTogether', async () => {
    known.set([
      plugin('a', '1.0.0', '1.1.0'),
      plugin('b', '1.0.0', '1.1.0'),
      plugin('c', '1.0.0', '1.1.0'),
    ]);
    failing = new Set<string>(['a', 'c']);

    await runAnswering(true);

    expect(installed).toEqual(['a', 'b', 'c']);
    const notice: Notification | undefined = failureNotice();
    expect(notice?.severity).toBe('error');
    expect(notice?.title).toBe('2 plugins could not be updated');
    expect(notice?.detail).toBe('A: a broke\nC: c broke');
  });
});
