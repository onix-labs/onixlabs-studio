import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Bridge } from '@shared/api/bridge';
import { ModelRuntimeChannel } from '@shared/api/model-runtime-channels';
import type {
  ModelPullProgress,
  RuntimeInstallation,
  RuntimeInstallProgress,
} from '@shared/api/model-runtime-types';
import {
  NotificationRequest,
  Notifications,
} from '@shared/angular/services/notifications/notifications';

import { ModelRuntimes } from './model-runtimes';

describe('ModelRuntimes notifications (#1491)', () => {
  let runtimes: ModelRuntimes;
  let raised: NotificationRequest[];
  let listeners: Map<string, (...args: unknown[]) => void>;
  let answer: unknown;
  let pushed: readonly unknown[];
  let during: () => Promise<void>;

  /**
   * Builds a pull progress update.
   * @param stage The stage.
   * @param error Why it failed, if it did.
   * @returns Returns the update.
   */
  function pull(stage: ModelPullProgress['stage'], error?: string): ModelPullProgress {
    return {
      model: 'llama3',
      stage,
      status: stage,
      received: 0,
      total: 0,
      ...(error === undefined ? {} : { error }),
    };
  }

  beforeEach(() => {
    raised = [];
    listeners = new Map<string, (...args: unknown[]) => void>();
    pushed = [];
    answer = true;
    during = (): Promise<void> => Promise.resolve();
    (window as unknown as { bridge: Bridge }).bridge = {
      invoke: async <T>(channel: string): Promise<T> => {
        if (channel === (ModelRuntimeChannel.CancelPull as string)) {
          return true as T;
        }
        await during();
        // The backend's progress pushes arrive before its answer.
        const progress: string =
          channel === (ModelRuntimeChannel.Pull as string)
            ? ModelRuntimeChannel.PullProgress
            : ModelRuntimeChannel.InstallProgress;
        for (const update of pushed) {
          listeners.get(progress)?.(update);
        }
        return answer as T;
      },
      send: vi.fn(),
      on: (channel: string, listener: (...args: unknown[]) => void): (() => void) => {
        listeners.set(channel, listener);
        return (): void => void listeners.delete(channel);
      },
    };
    TestBed.configureTestingModule({
      providers: [
        {
          provide: Notifications,
          useValue: { notify: (request: NotificationRequest): void => void raised.push(request) },
        },
      ],
    });
    runtimes = TestBed.inject(ModelRuntimes);
  });

  afterEach(() => {
    delete (window as unknown as { bridge?: Bridge }).bridge;
  });

  it('aFinishedPull_saysTheModelDownloaded', async () => {
    pushed = [pull('downloading'), pull('done')];

    expect(await runtimes.pull('llama3')).toBe(true);

    expect(raised).toEqual([
      expect.objectContaining({
        severity: 'success',
        title: 'llama3 downloaded',
        type: 'models.pullFinished',
        desktop: true,
      }),
    ]);
    expect(listeners.has(ModelRuntimeChannel.PullProgress)).toBe(false);
  });

  it('aFailedPull_saysWhy_andStays', async () => {
    answer = false;
    pushed = [pull('failed', 'The model was not found.')];

    await runtimes.pull('llama3');

    expect(raised[0]).toMatchObject({
      severity: 'error',
      title: "Couldn't download llama3",
      detail: 'The model was not found.',
      sticky: true,
      type: 'models.pullFailed',
    });
  });

  it('aCancelledPull_raisesNothing', async () => {
    answer = false;
    pushed = [pull('cancelled')];

    await runtimes.pull('llama3');

    expect(raised).toEqual([]);
  });

  it('aPullTheUserCancelled_raisesNothing_evenWithoutItsLastUpdate', async () => {
    answer = false;
    during = async (): Promise<void> => {
      await runtimes.cancelPull('llama3');
    };

    await runtimes.pull('llama3');

    expect(raised).toEqual([]);
  });

  it('aPullStartedAgainAfterACancel_isReportedAsUsual', async () => {
    answer = false;
    during = async (): Promise<void> => {
      await runtimes.cancelPull('llama3');
    };
    await runtimes.pull('llama3');
    during = (): Promise<void> => Promise.resolve();

    await runtimes.pull('llama3');

    expect(raised).toHaveLength(1);
  });

  it('aFinishedRuntimeInstall_saysSo_withItsVersion', async () => {
    answer = {
      kind: 'managed',
      executable: '/bin/ollama',
      version: '0.12.0',
    } satisfies RuntimeInstallation;

    await runtimes.install();

    expect(raised[0]).toMatchObject({
      severity: 'success',
      title: 'Model runtime installed',
      detail: 'Version 0.12.0',
      type: 'models.installFinished',
    });
  });

  it('aFailedRuntimeInstall_saysWhy', async () => {
    answer = { kind: 'absent', executable: '', version: '' } satisfies RuntimeInstallation;
    pushed = [
      { stage: 'failed', received: 0, total: 0, error: 'The download was interrupted.' },
    ] as readonly RuntimeInstallProgress[];

    await runtimes.install();

    expect(raised[0]).toMatchObject({
      severity: 'error',
      title: "Couldn't install the model runtime",
      detail: 'The download was interrupted.',
      type: 'models.installFailed',
    });
  });
});
