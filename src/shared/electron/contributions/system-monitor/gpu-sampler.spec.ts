import { describe, expect, it } from 'vitest';
import { GpuReading } from '@shared/api/system-monitor-channels';
import { GpuSampler, GpuSources } from './gpu-sampler';

/**
 * Builds sources answering each command with the next of its outputs, on a clock the test moves.
 * @param platform The platform.
 * @param outputs Each command's outputs in turn, by its first argument or name.
 * @param files Each file's content, by path.
 * @param folders Each folder's entries, by path.
 * @returns Returns the sources and a way to move the clock.
 */
function machine(
  platform: string,
  outputs: Record<string, string[]>,
  files: Record<string, string> = {},
  folders: Record<string, string[]> = {},
): { sources: GpuSources; advance: (ms: number) => void; calls: string[] } {
  let now: number = 1_000_000;
  const calls: string[] = [];
  return {
    calls,
    advance: (ms: number): void => {
      now += ms;
    },
    sources: {
      platform,
      run: (file: string, args: readonly string[]): Promise<string> => {
        const key: string = file === 'ioreg' ? (args.includes('-l') ? 'clients' : 'stats') : file;
        calls.push(key);
        const next: string | undefined = outputs[key]?.shift();
        return next === undefined ? Promise.reject(new Error(`no ${key}`)) : Promise.resolve(next);
      },
      readFile: (path: string): Promise<string> =>
        path in files ? Promise.resolve(files[path]) : Promise.reject(new Error(path)),
      readdir: (path: string): Promise<readonly string[]> =>
        path in folders ? Promise.resolve(folders[path]) : Promise.reject(new Error(path)),
      now: (): number => now,
    },
  };
}

/**
 * macOS statistics with the given GFX commands submitted so far.
 * @param commands The GFX channel's commands.
 * @returns Returns the output.
 */
function stats(commands: number): string {
  return `+-o Accel  <class AMDRadeonX6000_AMDNavi21GraphicsAccelerator, id 0x1>\n"PerformanceStatistics" = {"Device Utilization %"=5,"HWChannel GFX | Commands Submitted"=${commands}}`;
}

/**
 * macOS clients with the given GPU time used so far by one process.
 * @param ns The GPU time, in nanoseconds.
 * @returns Returns the output.
 */
function clients(ns: number): string {
  return `+-o Accel  <class X, id 0x1>\n  +-o Client  <class C, id 0x2>\n  |     "accumulatedGPUTime" = ${ns}\n  |     "IOUserClientCreator" = "pid 202, WindowServer"`;
}

describe('GpuSampler', () => {
  it('worksOutMacOsRates_fromTheChangeSinceTheLastReading', async () => {
    const { sources, advance } = machine('darwin', {
      stats: [stats(100), stats(300)],
      clients: [clients(0), clients(500_000_000)],
    });
    const sampler: GpuSampler = new GpuSampler(sources, true);

    const first: GpuReading | undefined = await sampler.read();
    expect(first?.engines).toEqual([]);
    expect(first?.processes).toEqual([]);

    advance(2000);
    const second: GpuReading | undefined = await sampler.read();
    // 200 commands over 2 s; 0.5 s of GPU time over 2 s.
    expect(second?.engines).toEqual([
      { kind: '3d', label: '3D / Graphics', value: 100, unit: 'commands' },
    ]);
    expect(second?.processes).toEqual([{ pid: 202, name: 'WindowServer', gpuPercent: 25 }]);
    expect(second?.utilisationPercent).toBe(5);
  });

  it('readsTheFiguresAlone_forAnUndetailedReading', async () => {
    const { sources, calls } = machine('darwin', { stats: [stats(1)] });

    const reading: GpuReading | undefined = await new GpuSampler(sources, false).read();

    expect(calls).toEqual(['stats']);
    expect(reading?.engines).toEqual([]);
  });

  it('readsAnAmdCardsSysfs_onLinux', async () => {
    const device: string = '/sys/class/drm/card1/device';
    const { sources } = machine(
      'linux',
      {},
      {
        '/sys/class/drm/card0/device/vendor': '0x8086',
        [`${device}/vendor`]: '0x1002\n',
        [`${device}/gpu_busy_percent`]: '40',
        [`${device}/hwmon/hwmon3/temp1_input`]: '50000',
      },
      { '/sys/class/drm': ['card0', 'card1', 'renderD128'], [`${device}/hwmon`]: ['hwmon3'] },
    );

    const reading: GpuReading | undefined = await new GpuSampler(sources, true).read();

    expect([reading?.utilisationPercent, reading?.temperatureC]).toEqual([40, 50]);
  });

  it('stopsAskingNvidiaSmi_onceItIsMissing', async () => {
    const { sources, calls } = machine('linux', {}, {}, { '/sys/class/drm': [] });
    const sampler: GpuSampler = new GpuSampler(sources, false);

    expect(await sampler.read()).toBeUndefined();
    expect(await sampler.read()).toBeUndefined();
    expect(calls.filter((call: string): boolean => call === 'nvidia-smi')).toHaveLength(1);
  });

  it('readsWindowsCounters_andMarksTheReadingCostly', async () => {
    const { sources } = machine('win32', {
      'powershell.exe': [
        JSON.stringify([
          {
            Path: '\\\\pc\\gpu engine(pid_9_luid_0x0_0x1_phys_0_eng_0_engtype_3d)\\utilization percentage',
            InstanceName: 'pid_9_luid_0x0_0x1_phys_0_eng_0_engtype_3d',
            CookedValue: 12,
          },
        ]),
      ],
    });
    const sampler: GpuSampler = new GpuSampler(sources, false);

    const reading: GpuReading | undefined = await sampler.read();

    expect(reading?.utilisationPercent).toBe(12);
    expect(sampler.costly).toBe(true);
  });
});
