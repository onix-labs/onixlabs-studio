import { describe, expect, it } from 'vitest';
import { GpuEngineReading, GpuProcessReading } from '@shared/api/system-monitor-channels';
import {
  architectureOf,
  engineKindOfChannel,
  GpuFigures,
  IoregClient,
  IoregStatistics,
  parseAmdgpuSysfs,
  parseDpmClock,
  parseIoregClients,
  parseIoregStatistics,
  parseNvidiaPmon,
  parseNvidiaQuery,
  parseWindowsGpuCounters,
  WindowsGpuCounter,
} from './gpu-readers';

/**
 * The accelerator's head line, as macOS prints it (listed twice: once per class it matches).
 */
const HEAD: string =
  '+-o AMDRadeonX6000_AMDNavi21GraphicsAccelerator  <class AMDRadeonX6000_AMDNavi21GraphicsAccelerator, id 0x1000008e9, registered, matched, active, busy 0 (2881 ms), retain 156>';

/**
 * This Mac's accelerator statistics, trimmed.
 */
const STATISTICS: string = [
  HEAD,
  '    {',
  '      "CFBundleIdentifier" = "com.apple.kext.AMDRadeonX6000"',
  '      "PerformanceStatistics" = {"GPU Activity(%)"=2,"Device Utilization %"=0,"Temperature(C)"=62,"Total Power(W)"=71,"Fan Speed(RPM)"=589,"Fan Speed(%)"=17,"Core Clock(MHz)"=124,"Memory Clock(MHz)"=1988,"inUseVidMemoryBytes"=2118889472,"HWChannel GFX | Commands Submitted"=212,"HWChannel GFX | Commands Completed"=212,"HWChannel VCN0Dec | Commands Submitted"=4,"HWChannel VCN1Dec | Commands Submitted"=1,"HWChannel VCN0Enc | Commands Submitted"=0,"HWChannel SDMA0 | Commands Submitted"=38,"HWChannel SDMA1_PAGE | Commands Submitted"=78,"HWChannel KIQ | Commands Submitted"=9}',
  '    }',
  HEAD.replace('retain 156', 'retain 155'),
  '      "PerformanceStatistics" = {"GPU Activity(%)"=99}',
].join('\n');

describe('parseIoregStatistics', () => {
  it('readsTheGpusFigures_fromItsFirstListing', () => {
    const statistics: IoregStatistics | undefined = parseIoregStatistics(STATISTICS);

    expect(statistics?.figures).toEqual({
      utilisationPercent: 0,
      memoryUsedBytes: 2118889472,
      temperatureC: 62,
      powerWatts: 71,
      fanRpm: 589,
      fanPercent: 17,
      coreClockMhz: 124,
      memoryClockMhz: 1988,
    });
    expect(statistics?.driverClass).toBe('AMDRadeonX6000_AMDNavi21GraphicsAccelerator');
  });

  it('sumsEachEngineKindsCommands_leavingOutTheKernelsQueues', () => {
    expect(Object.fromEntries(parseIoregStatistics(STATISTICS)?.commands ?? [])).toEqual({
      '3d': 212,
      decode: 5,
      encode: 0,
      copy: 116,
    });
  });

  it('readsAppleSiliconsRendererAndTilerShares', () => {
    const statistics: IoregStatistics | undefined = parseIoregStatistics(
      '+-o AGXAcceleratorG13X  <class AGXAcceleratorG13X, id 0x1>\n"PerformanceStatistics" = {"Device Utilization %"=30,"Renderer Utilization %"=28,"Tiler Utilization %"=9,"In use system memory"=1048576}',
    );

    expect(
      statistics?.engines.map(
        (engine: GpuEngineReading): string => `${engine.label} ${engine.value}%`,
      ),
    ).toEqual(['Renderer 28%', 'Tiler 9%']);
    expect(statistics?.figures.memoryUsedBytes).toBe(1048576);
  });

  it('isUndefined_withoutAnAccelerator', () => {
    expect(parseIoregStatistics('')).toBeUndefined();
  });
});

describe('parseIoregClients', () => {
  it('sumsEachProcessesGpuTime_acrossItsClients_countingTheAcceleratorOnce', () => {
    const block: (pid: number, name: string, time: number) => string = (
      pid: number,
      name: string,
      time: number,
    ): string =>
      `  +-o AMDRadeonX6000_AMDAccelDevice  <class AMDRadeonX6000_AMDAccelDevice, id 0x2>\n  |     "accumulatedGPUTime" = ${time}\n  |     "IOUserClientCreator" = "pid ${pid}, ${name}"`;
    const section: string = [
      HEAD,
      block(202, 'WindowServer', 100),
      block(202, 'WindowServer', 50),
      block(1316, 'ONIXLabs Studio Helper (Renderer)', 7),
      '  +-o IOAccelDisplayPipeUserClient2  <class IOAccelDisplayPipeUserClient2, id 0x3>',
      '  |     "IOUserClientCreator" = "pid 99, NoTime"',
    ].join('\n');

    const clients: ReadonlyMap<number, IoregClient> = parseIoregClients(`${section}\n${section}`);

    expect(Object.fromEntries(clients)).toEqual({
      202: { name: 'WindowServer', gpuTimeNs: 150 },
      1316: { name: 'ONIXLabs Studio Helper (Renderer)', gpuTimeNs: 7 },
    });
  });
});

describe('architectureOf', () => {
  it('namesTheArchitecture_fromTheDriverClassOrModel', () => {
    expect(architectureOf('AMDRadeonX6000_AMDNavi21GraphicsAccelerator')).toBe('RDNA 2');
    expect(architectureOf('', 'NVIDIA GeForce RTX 4090')).toBe('Ada Lovelace');
    expect(architectureOf('Mystery GPU')).toBeUndefined();
  });

  it('mapsAmdChannels_toWhatTheyDo', () => {
    expect(['GFX', 'VCN0Dec', 'VCN1EncLLQ', 'SDMA0_PAGE', 'KIQ'].map(engineKindOfChannel)).toEqual([
      '3d',
      'decode',
      'encode',
      'copy',
      undefined,
    ]);
  });
});

describe('nvidia-smi', () => {
  it('readsTheQuery_inMiB_withNotSupportedAsNothing', () => {
    const figures: GpuFigures = parseNvidiaQuery(
      '2, 786, 24564, 256, 43, 28.05, 450.00, [N/A], 210, 405\n',
    );

    expect(figures).toEqual({
      utilisationPercent: 2,
      memoryUsedBytes: 786 * 1024 ** 2,
      memoryTotalBytes: 24564 * 1024 ** 2,
      memoryReservedBytes: 256 * 1024 ** 2,
      temperatureC: 43,
      powerWatts: 28.05,
      powerLimitWatts: 450,
      coreClockMhz: 210,
      memoryClockMhz: 405,
    });
  });

  it('readsPmon_byItsHeadersColumns', () => {
    const processes: readonly GpuProcessReading[] = parseNvidiaPmon(
      [
        '# gpu         pid   type     sm    mem    enc    dec    jpg    ofa     fb   command',
        '# Idx           #    C/G      %      %      %      %      %      %     MB   name',
        '    0        1312     G      2      0      -      -      -      -    412   studio',
        '    0       27473     C      -      -      5     10      -      -    156   ffmpeg',
      ].join('\n'),
    );

    expect(processes).toEqual([
      { pid: 1312, name: 'studio', gpuPercent: 2, memoryBytes: 412 * 1024 ** 2 },
      {
        pid: 27473,
        name: 'ffmpeg',
        encoderPercent: 5,
        decoderPercent: 10,
        memoryBytes: 156 * 1024 ** 2,
      },
    ]);
  });
});

describe('parseWindowsGpuCounters', () => {
  it('readsEnginesAndProcesses_asTaskManagerDoes', () => {
    const engine: (pid: number, eng: number, type: string, value: number) => WindowsGpuCounter = (
      pid: number,
      eng: number,
      type: string,
      value: number,
    ): WindowsGpuCounter => ({
      Path: `\\\\pc\\gpu engine(pid_${pid}_luid_0x0_0x1_phys_0_eng_${eng}_engtype_${type})\\utilization percentage`,
      InstanceName: `pid_${pid}_luid_0x0_0x1_phys_0_eng_${eng}_engtype_${type}`,
      CookedValue: value,
    });
    const reading: ReturnType<typeof parseWindowsGpuCounters> = parseWindowsGpuCounters([
      engine(10, 0, '3D', 20),
      engine(11, 0, '3D', 15),
      engine(10, 4, 'VideoDecode', 8),
      {
        Path: '\\\\pc\\gpu process memory(pid_10_luid_0x0_0x1_phys_0)\\dedicated usage',
        InstanceName: 'pid_10_luid_0x0_0x1_phys_0',
        CookedValue: 1000,
      },
      {
        Path: '\\\\pc\\gpu adapter memory(luid_0x0_0x1_phys_0)\\dedicated usage',
        InstanceName: 'luid_0x0_0x1_phys_0',
        CookedValue: 5000,
      },
    ]);

    // 3D is its engine's sum across processes; the GPU is its busiest kind.
    expect(reading.figures).toEqual({ utilisationPercent: 35, memoryUsedBytes: 5000 });
    expect(
      reading.engines.map((engine: GpuEngineReading): string => `${engine.kind} ${engine.value}`),
    ).toEqual(['3d 35', 'decode 8']);
    // A process is its busiest engine.
    expect(
      reading.processes.find((process: GpuProcessReading): boolean => process.pid === 10),
    ).toEqual({
      pid: 10,
      gpuPercent: 20,
      memoryBytes: 1000,
    });
  });
});

describe('amdgpu', () => {
  it('readsTheCardsSysfs_inItsUnits', () => {
    const figures: GpuFigures = parseAmdgpuSysfs(
      new Map<string, string>([
        ['gpu_busy_percent', '12\n'],
        ['mem_info_vram_used', '1073741824'],
        ['mem_info_vram_total', '17179869184'],
        ['hwmon/temp1_input', '45000'],
        ['hwmon/power1_average', '30000000'],
        ['hwmon/power1_cap', '255000000'],
        ['hwmon/fan1_input', '0'],
        ['pp_dpm_sclk', '0: 500Mhz\n1: 2100Mhz *\n'],
      ]),
    );

    expect(figures).toEqual({
      utilisationPercent: 12,
      memoryUsedBytes: 1073741824,
      memoryTotalBytes: 17179869184,
      temperatureC: 45,
      powerWatts: 30,
      powerLimitWatts: 255,
      fanRpm: 0,
      coreClockMhz: 2100,
    });
  });

  it('readsTheCurrentClockLevel', () => {
    expect(parseDpmClock('0: 96Mhz *\n1: 1000Mhz')).toBe(96);
    expect(parseDpmClock('')).toBeUndefined();
  });
});
