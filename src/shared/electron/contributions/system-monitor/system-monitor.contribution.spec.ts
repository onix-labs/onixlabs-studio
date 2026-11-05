import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcMainEvent } from 'electron';
import { MetricsSample, SystemMonitorChannel } from '@shared/api/system-monitor-channels';
import type { ContributionContext, ContributionListener } from '../main-contribution';

/**
 * What the machine reports. Nothing here is the machine's: every source is replaced below.
 */
const machine: {
  network: () => Promise<unknown[]>;
  disk: () => Promise<unknown>;
  graphics: () => Promise<unknown>;
  ioreg: () => Promise<{ stdout: string }>;
  appMetrics: () => unknown[];
  counts: { network: number; disk: number; graphics: number; ioreg: number };
} = vi.hoisted(() => ({
  network: (): Promise<unknown[]> => Promise.resolve([]),
  disk: (): Promise<unknown> => Promise.resolve(null),
  graphics: (): Promise<unknown> => Promise.resolve({ controllers: [] }),
  ioreg: (): Promise<{ stdout: string }> => Promise.resolve({ stdout: '' }),
  appMetrics: (): unknown[] => [],
  counts: { network: 0, disk: 0, graphics: 0, ioreg: 0 },
}));

vi.mock('electron', () => {
  const app: { getAppMetrics: () => unknown[]; isReady: () => boolean; isPackaged: boolean } = {
    getAppMetrics: (): unknown[] => machine.appMetrics(),
    isReady: (): boolean => false,
    isPackaged: false,
  };
  return { app, ipcMain: {}, shell: {} };
});

vi.mock('systeminformation', () => {
  const networkStats: () => Promise<unknown[]> = (): Promise<unknown[]> => {
    machine.counts.network += 1;
    return machine.network();
  };
  const fsStats: () => Promise<unknown> = (): Promise<unknown> => {
    machine.counts.disk += 1;
    return machine.disk();
  };
  const graphics: () => Promise<unknown> = (): Promise<unknown> => {
    machine.counts.graphics += 1;
    return machine.graphics();
  };
  return { networkStats, fsStats, graphics, default: { networkStats, fsStats, graphics } };
});

vi.mock('node:child_process', () => {
  const execFile: (
    file: string,
    args: readonly string[],
    options: unknown,
    done: (error: Error | null, result?: { stdout: string }) => void,
  ) => void = (_file, _args, _options, done): void => {
    machine.counts.ioreg += 1;
    machine.ioreg().then(
      (result: { stdout: string }): void => done(null, result),
      (error: Error): void => done(error),
    );
  };
  return { execFile, default: { execFile } };
});

// Imported only now, behind the mocks above, so nothing of it can bind to the real modules.
const { SystemMonitorContribution } = await import('./system-monitor.contribution');

describe('SystemMonitorContribution', () => {
  const platform: NodeJS.Platform = process.platform;
  const event: IpcMainEvent = {} as IpcMainEvent;
  let listeners: Map<string, ContributionListener>;
  let samples: MetricsSample[];
  let contribution: InstanceType<typeof SystemMonitorContribution>;

  /**
   * Builds the context the contribution activates against.
   * @returns Returns the context.
   */
  function context(): ContributionContext {
    return {
      handle: (): void => undefined,
      on: (channel: string, listener: ContributionListener): void =>
        void listeners.set(channel, listener),
      send: (_channel: string, sample: unknown): void => void samples.push(sample as MetricsSample),
      permission: <T>(): T => {
        throw new Error('The monitor declares no permissions.');
      },
      mainWindow: () => null,
      log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    };
  }

  /**
   * Sends a message as the renderer would.
   * @param channel The channel.
   * @param payload The payload.
   */
  function send(channel: SystemMonitorChannel, payload?: unknown): void {
    listeners.get(channel)?.(event, payload);
  }

  /**
   * Moves time on, letting what it started finish.
   * @param ms How far.
   */
  async function advance(ms: number): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
  }

  /**
   * Runs the platform the contribution reads.
   * @param value The platform.
   */
  function setPlatform(value: NodeJS.Platform): void {
    Object.defineProperty(process, 'platform', { value, configurable: true });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    setPlatform('linux');
    machine.network = (): Promise<unknown[]> =>
      Promise.resolve([{ rx_sec: 10, tx_sec: 20 }, { rx_sec: 1 }]);
    machine.disk = (): Promise<unknown> => Promise.resolve({ rx_sec: 5, wx_sec: 6 });
    machine.graphics = (): Promise<unknown> =>
      Promise.resolve({ controllers: [{ utilizationGpu: 40 }] });
    machine.ioreg = (): Promise<{ stdout: string }> => Promise.resolve({ stdout: '' });
    machine.appMetrics = (): unknown[] => [];
    machine.counts = { network: 0, disk: 0, graphics: 0, ioreg: 0 };
    listeners = new Map<string, ContributionListener>();
    samples = [];
    contribution = new SystemMonitorContribution();
    contribution.activate(context());
  });

  afterEach(() => {
    contribution.dispose();
    vi.useRealTimers();
    setPlatform(platform);
  });

  it('readsNothing_untilSomethingAsks', async () => {
    await advance(10_000);

    expect(samples).toEqual([]);
    expect(machine.counts.network).toBe(0);
  });

  it('pushesASampleEachInterval_whileAskedTo', async () => {
    send(SystemMonitorChannel.Start);
    await advance(3_000);

    expect(samples).toHaveLength(3);
    expect(samples[0].memory.totalBytes).toBeGreaterThan(0);
    expect(samples[0].network).toEqual({ rxBytesPerSec: 11, txBytesPerSec: 20 });
    expect(samples[0].disk).toEqual({ readBytesPerSec: 5, writeBytesPerSec: 6 });
    expect(samples[0].gpu).toEqual({ available: true, percent: 40 });
  });

  it('sharesOneLoop_betweenConsumers', async () => {
    send(SystemMonitorChannel.Start);
    send(SystemMonitorChannel.Start);
    await advance(2_000);

    expect(samples).toHaveLength(2);

    send(SystemMonitorChannel.Stop);
    await advance(1_000);

    expect(samples).toHaveLength(3);

    send(SystemMonitorChannel.Stop);
    await advance(5_000);

    expect(samples).toHaveLength(3);
  });

  it('anExtraStop_doesNotOweAConsumerLater', async () => {
    send(SystemMonitorChannel.Stop);
    send(SystemMonitorChannel.Start);
    await advance(1_000);
    send(SystemMonitorChannel.Stop);
    await advance(5_000);

    expect(samples).toHaveLength(1);
  });

  it('survivesEachCostlyReadingFailing', async () => {
    machine.network = (): Promise<unknown[]> => Promise.reject(new Error('no network stats'));
    machine.disk = (): Promise<unknown> => Promise.reject(new Error('no disk stats'));
    machine.graphics = (): Promise<unknown> => Promise.reject(new Error('no gpu'));

    send(SystemMonitorChannel.Start);
    await advance(1_000);

    expect(samples).toHaveLength(1);
    expect(samples[0].cpu).toBeGreaterThanOrEqual(0);
    expect(samples[0].network).toBeUndefined();
    expect(samples[0].disk).toBeUndefined();
    expect(samples[0].gpu).toBeUndefined();
  });

  it('omitsTheAppReading_whenElectronCannotGiveIt', async () => {
    machine.appMetrics = (): unknown[] => {
      throw new Error('not ready');
    };

    send(SystemMonitorChannel.Start);
    await advance(1_000);

    expect(samples).toHaveLength(1);
    expect(samples[0].app).toBeUndefined();
  });

  it('doesNotPileUpTicks_behindASlowRead', async () => {
    send(SystemMonitorChannel.Start);
    await advance(1_000);
    expect(samples).toHaveLength(1);

    let finish: (stats: unknown[]) => void = (): void => undefined;
    machine.network = (): Promise<unknown[]> =>
      new Promise<unknown[]>((resolve: (stats: unknown[]) => void): void => {
        finish = resolve;
      });
    await advance(2_000);
    const reads: number = machine.counts.network;
    const pushed: number = samples.length;

    await advance(30_000);

    // Stuck on the one read, with no more started and nothing pushed.
    expect(machine.counts.network).toBe(reads);
    expect(samples).toHaveLength(pushed);

    finish([]);
    await advance(1_000);

    expect(samples.length).toBeGreaterThan(pushed);
  });

  it('carriesCostlyReadingsForward_atAFastRate', async () => {
    send(SystemMonitorChannel.Rate, { intervalMs: 500 });
    send(SystemMonitorChannel.Start);

    await advance(2_500);

    expect(samples.length).toBeGreaterThanOrEqual(4);
    // The priming read alone: the next is not due for three seconds.
    expect(machine.counts.network).toBe(1);
    expect(samples.at(-1)?.network).toEqual({ rxBytesPerSec: 11, txBytesPerSec: 20 });
  });

  it('retimesARunningLoop_onANewRate', async () => {
    send(SystemMonitorChannel.Start);
    await advance(1_000);
    samples.length = 0;

    send(SystemMonitorChannel.Rate, { intervalMs: 2_000 });
    await advance(6_000);

    expect(samples).toHaveLength(3);
  });

  it('takesAMalformedRate_asTheDefault', async () => {
    send(SystemMonitorChannel.Rate, 'fast');
    send(SystemMonitorChannel.Rate, null);
    send(SystemMonitorChannel.Start);

    await advance(2_000);

    expect(samples).toHaveLength(2);
  });

  it('startsAtTheRateItWasGiven_whileIdle', async () => {
    send(SystemMonitorChannel.Rate, { intervalMs: 2_000 });

    await advance(2_000);
    expect(samples).toEqual([]);

    send(SystemMonitorChannel.Start);
    await advance(2_000);

    expect(samples).toHaveLength(1);
  });

  describe('the GPU', () => {
    it('isNotReadAtAll_whenTheSettingIsOff', async () => {
      send(SystemMonitorChannel.Rate, { gpu: false });
      send(SystemMonitorChannel.Start);

      await advance(10_000);

      expect(machine.counts.graphics).toBe(0);
      expect(samples.at(-1)?.gpu).toBeUndefined();
    });

    it('stopsBeingAsked_onceNoSourceReports_untilSamplingNextStarts', async () => {
      machine.graphics = (): Promise<unknown> => Promise.resolve({ controllers: [{}] });
      send(SystemMonitorChannel.Start);

      await advance(10_000);

      expect(machine.counts.graphics).toBe(1);

      send(SystemMonitorChannel.Stop);
      send(SystemMonitorChannel.Start);
      await advance(1_000);

      expect(machine.counts.graphics).toBe(2);
    });

    it('prefersIoreg_onMacOs', async () => {
      setPlatform('darwin');
      machine.ioreg = (): Promise<{ stdout: string }> =>
        Promise.resolve({ stdout: '"PerformanceStatistics" = {"Device Utilization %"=73}' });

      send(SystemMonitorChannel.Start);
      await advance(1_000);

      expect(samples[0].gpu).toEqual({ available: true, percent: 73 });
      expect(machine.counts.graphics).toBe(0);
    });

    it('fallsBack_whenIoregFails', async () => {
      setPlatform('darwin');
      machine.ioreg = (): Promise<{ stdout: string }> => Promise.reject(new Error('timed out'));

      send(SystemMonitorChannel.Start);
      await advance(1_000);

      expect(samples[0].gpu).toEqual({ available: true, percent: 40 });
    });

    it('fallsBack_whenIoregReportsNoUtilisation', async () => {
      setPlatform('darwin');
      machine.ioreg = (): Promise<{ stdout: string }> => Promise.resolve({ stdout: 'nothing' });

      send(SystemMonitorChannel.Start);
      await advance(1_000);

      expect(samples[0].gpu).toEqual({ available: true, percent: 40 });
    });
  });

  describe('dispose', () => {
    it('stopsTheLoop', async () => {
      send(SystemMonitorChannel.Start);
      await advance(1_000);

      contribution.dispose();
      await advance(5_000);

      expect(samples).toHaveLength(1);
    });

    it('dropsASampleStillBeingRead', async () => {
      send(SystemMonitorChannel.Start);
      await advance(1_000);
      samples.length = 0;
      let finish: (stats: unknown[]) => void = (): void => undefined;
      machine.network = (): Promise<unknown[]> =>
        new Promise<unknown[]>((resolve: (stats: unknown[]) => void): void => {
          finish = resolve;
        });
      await advance(2_000);
      samples.length = 0;

      contribution.dispose();
      finish([]);
      await advance(1_000);

      expect(samples).toEqual([]);
    });

    it('isSafe_whenIdle', () => {
      expect(() => contribution.dispose()).not.toThrow();
    });
  });
});
