import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcMainEvent } from 'electron';
import {
  MetricsSample,
  ProcessesSnapshot,
  SystemInfo,
  SystemMonitorChannel,
} from '@shared/api/system-monitor-channels';
import type {
  ContributionContext,
  ContributionListener,
  InvokeHandler,
} from '../main-contribution';

/**
 * What the machine reports. Nothing here is the machine's: every source is replaced below.
 */
const machine: {
  network: () => Promise<unknown[]>;
  disk: () => Promise<unknown>;
  graphics: () => Promise<unknown>;
  ioreg: () => Promise<{ stdout: string }>;
  appMetrics: () => unknown[];
  processes: () => Promise<unknown>;
  mem: () => Promise<unknown>;
  fsSize: () => Promise<unknown[]>;
  counts: { network: number; disk: number; graphics: number; ioreg: number; processes: number };
} = vi.hoisted(() => ({
  network: (): Promise<unknown[]> => Promise.resolve([]),
  disk: (): Promise<unknown> => Promise.resolve(null),
  graphics: (): Promise<unknown> => Promise.resolve({ controllers: [] }),
  ioreg: (): Promise<{ stdout: string }> => Promise.resolve({ stdout: '' }),
  appMetrics: (): unknown[] => [],
  processes: (): Promise<unknown> => Promise.resolve({ all: 0, list: [] }),
  mem: (): Promise<unknown> => Promise.reject(new Error('unavailable')),
  fsSize: (): Promise<unknown[]> => Promise.reject(new Error('unavailable')),
  counts: { network: 0, disk: 0, graphics: 0, ioreg: 0, processes: 0 },
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
  const processes: () => Promise<unknown> = (): Promise<unknown> => {
    machine.counts.processes += 1;
    return machine.processes();
  };
  const mem: () => Promise<unknown> = (): Promise<unknown> => machine.mem();
  const fsSize: () => Promise<unknown[]> = (): Promise<unknown[]> => machine.fsSize();
  const cpu: () => Promise<unknown> = (): Promise<unknown> =>
    Promise.resolve({ physicalCores: 4, performanceCores: 4, efficiencyCores: 0, speed: 3.2 });
  const osInfo: () => Promise<unknown> = (): Promise<unknown> =>
    Promise.resolve({ distro: 'macOS', release: '26.6' });
  const memLayout: () => Promise<unknown[]> = (): Promise<unknown[]> => Promise.resolve([]);
  const cpuCache: () => Promise<unknown> = (): Promise<unknown> =>
    Promise.resolve({ l1d: 32768, l1i: 32768, l2: 1048576, l3: 8388608 });
  const all: Record<string, unknown> = {
    networkStats,
    fsStats,
    graphics,
    processes,
    mem,
    fsSize,
    cpu,
    osInfo,
    cpuCache,
    memLayout,
  };
  return { ...all, default: all };
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

// The listing's per-process extras read /proc on Linux (the platform these tests run as); none exists
// here, and a real read would outlast the fake clock.
vi.mock('node:fs/promises', () => {
  const readFile: () => Promise<string> = (): Promise<string> =>
    Promise.reject(new Error('No /proc here.'));
  return { readFile, default: { readFile } };
});

// Imported only now, behind the mocks above, so nothing of it can bind to the real modules.
const { SystemMonitorContribution } = await import('./system-monitor.contribution');

describe('SystemMonitorContribution', () => {
  const platform: NodeJS.Platform = process.platform;
  const event: IpcMainEvent = {} as IpcMainEvent;
  let listeners: Map<string, ContributionListener>;
  let samples: MetricsSample[];
  let snapshots: ProcessesSnapshot[];
  let handlers: Map<string, InvokeHandler>;
  let contribution: InstanceType<typeof SystemMonitorContribution>;

  /**
   * Builds the context the contribution activates against.
   * @returns Returns the context.
   */
  function context(): ContributionContext {
    return {
      handle: (channel: string, handler: InvokeHandler): void =>
        void handlers.set(channel, handler),
      on: (channel: string, listener: ContributionListener): void =>
        void listeners.set(channel, listener),
      send: (channel: string, payload: unknown): void =>
        void (channel === SystemMonitorChannel.Processes.valueOf()
          ? snapshots.push(payload as ProcessesSnapshot)
          : samples.push(payload as MetricsSample)),
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
    machine.processes = (): Promise<unknown> => Promise.resolve({ all: 0, list: [] });
    machine.mem = (): Promise<unknown> => Promise.reject(new Error('unavailable'));
    machine.fsSize = (): Promise<unknown[]> => Promise.reject(new Error('unavailable'));
    machine.counts = { network: 0, disk: 0, graphics: 0, ioreg: 0, processes: 0 };
    listeners = new Map<string, ContributionListener>();
    handlers = new Map<string, InvokeHandler>();
    samples = [];
    snapshots = [];
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
    expect(samples[0].gpu).toEqual({ available: true, percent: 40, source: 'nvidia-smi' });
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

      expect(samples[0].gpu).toEqual({ available: true, percent: 73, source: 'ioreg' });
      expect(machine.counts.graphics).toBe(0);
    });

    it('fallsBack_whenIoregFails', async () => {
      setPlatform('darwin');
      machine.ioreg = (): Promise<{ stdout: string }> => Promise.reject(new Error('timed out'));

      send(SystemMonitorChannel.Start);
      await advance(1_000);

      expect(samples[0].gpu).toEqual({ available: true, percent: 40, source: 'nvidia-smi' });
    });

    it('fallsBack_whenIoregReportsNoUtilisation', async () => {
      setPlatform('darwin');
      machine.ioreg = (): Promise<{ stdout: string }> => Promise.resolve({ stdout: 'nothing' });

      send(SystemMonitorChannel.Start);
      await advance(1_000);

      expect(samples[0].gpu).toEqual({ available: true, percent: 40, source: 'nvidia-smi' });
    });
  });

  it('carriesPerInterfaceNetwork_memoryDetailAndVolumes', async () => {
    machine.network = (): Promise<unknown[]> =>
      Promise.resolve([
        { iface: 'en0', rx_sec: 10, tx_sec: 20 },
        { iface: 'lo0', rx_sec: 1 },
      ]);
    machine.mem = (): Promise<unknown> =>
      Promise.resolve({ available: 900, swapused: 10, swaptotal: 100 });
    machine.fsSize = (): Promise<unknown[]> =>
      Promise.resolve([{ mount: '/', type: 'apfs', size: 1000, used: 250 }]);
    send(SystemMonitorChannel.Start);
    await advance(1_000);

    expect(samples[0].interfaces?.map((stat: { name: string }): string => stat.name)).toEqual([
      'en0',
      'lo0',
    ]);
    expect(samples[0].memoryDetail).toEqual({
      availableBytes: 900,
      swapUsedBytes: 10,
      swapTotalBytes: 100,
    });
    expect(samples[0].volumes).toEqual([
      { mount: '/', type: 'apfs', sizeBytes: 1000, usedBytes: 250 },
    ]);
  });

  it('measuresMemoryInUse_asWhatIsNotAvailable_onceTheBreakdownIsRead', async () => {
    machine.mem = (): Promise<unknown> =>
      Promise.resolve({ available: 1024, swapused: 0, swaptotal: 0 });
    send(SystemMonitorChannel.Start);
    await advance(1_000);

    const { usedBytes, totalBytes }: { usedBytes: number; totalBytes: number } = samples[0].memory;
    expect(usedBytes).toBe(totalBytes - 1024);
  });

  it('omitsMemoryDetailAndVolumes_whenUnavailable', async () => {
    send(SystemMonitorChannel.Start);
    await advance(1_000);

    expect('memoryDetail' in samples[0]).toBe(false);
    expect('volumes' in samples[0]).toBe(false);
  });

  describe('processes', () => {
    it('listsNothing_untilSomethingAsks_evenWhileSampling', async () => {
      send(SystemMonitorChannel.Start);
      await advance(10_000);

      expect(machine.counts.processes).toBe(0);
      expect(snapshots).toEqual([]);
    });

    it('listsAtOnce_thenEveryTwoSeconds_untilTheLastConsumerStops', async () => {
      machine.processes = (): Promise<unknown> =>
        Promise.resolve({
          all: 2,
          list: [
            { pid: process.pid, parentPid: 1, name: 'Studio', cpu: 10, memRss: 1 },
            { pid: 99_999, parentPid: process.pid, name: 'zsh', cpu: 1, memRss: 1 },
          ],
        });
      send(SystemMonitorChannel.ProcessesStart);
      send(SystemMonitorChannel.ProcessesStart);
      await advance(0);
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].total).toBe(2);
      expect(
        snapshots[0].processes.map((p: { studio?: string }): string | undefined => p.studio),
      ).toEqual(['main', 'child']);

      await advance(4_000);
      expect(snapshots).toHaveLength(3);

      send(SystemMonitorChannel.ProcessesStop);
      await advance(2_000);
      expect(snapshots).toHaveLength(4);

      send(SystemMonitorChannel.ProcessesStop);
      await advance(10_000);
      expect(snapshots).toHaveLength(4);
    });

    it('skipsAFailedListing', async () => {
      machine.processes = (): Promise<unknown> => Promise.reject(new Error('ps failed'));
      send(SystemMonitorChannel.ProcessesStart);
      await advance(4_000);

      expect(machine.counts.processes).toBe(3);
      expect(snapshots).toEqual([]);
    });
  });

  it('describesTheMachine', async () => {
    const info: SystemInfo = (await handlers.get(SystemMonitorChannel.Info)?.(
      {} as never,
    )) as SystemInfo;

    expect(info.logicalCores).toBeGreaterThan(0);
    expect(info.physicalCores).toBe(4);
    // Not a hybrid CPU, so no performance/efficiency split.
    expect(info.performanceCores).toBeUndefined();
    expect(info.efficiencyCores).toBeUndefined();
    expect(info.speedGhz).toBe(3.2);
    expect(info.os).toBe('macOS 26.6');
    expect(info.architecture.length).toBeGreaterThan(0);
    // The mocked CPU's maximum is not above its base, so there is none.
    expect(info.maxSpeedGhz).toBeUndefined();
    // Read as totals off macOS (these tests run as Linux).
    expect(info.caches.map((cache: { level: string }): string => cache.level)).toEqual([
      'L1',
      'L2',
      'L3',
    ]);
    // Best-effort: a sandboxed run can be refused the uptime, and then there is no boot time.
    if (info.bootTime !== undefined) {
      expect(info.bootTime).toBeLessThanOrEqual(Date.now());
    }
    // The mocked controller names no model, so no GPU is described.
    expect(info.gpus).toEqual([]);
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
