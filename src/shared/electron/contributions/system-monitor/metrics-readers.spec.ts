import { describe, expect, it } from 'vitest';
import { AppUsageMetric } from '@shared/api/system-monitor-channels';
import {
  architectureName,
  CpuCacheStat,
  parseIoregGpu,
  pickGpu,
  readAppUsage,
  readCaches,
  readDisk,
  readGpus,
  readInterfaces,
  readMemoryDetail,
  readVolumes,
  sumNetwork,
} from './metrics-readers';

describe('sumNetwork', () => {
  it('sumsRxAndTxAcrossInterfaces', () => {
    expect(
      sumNetwork([
        { rx_sec: 100, tx_sec: 10 },
        { rx_sec: 50, tx_sec: 5 },
      ]),
    ).toEqual({ rxBytesPerSec: 150, txBytesPerSec: 15 });
  });

  it('treatsNullAndNegativeRatesAsZero', () => {
    expect(sumNetwork([{ rx_sec: null, tx_sec: -1 }])).toEqual({
      rxBytesPerSec: 0,
      txBytesPerSec: 0,
    });
  });

  it('isZeroForNoInterfaces', () => {
    expect(sumNetwork([])).toEqual({ rxBytesPerSec: 0, txBytesPerSec: 0 });
  });
});

describe('readDisk', () => {
  it('mapsReadAndWriteThroughput', () => {
    expect(readDisk({ rx_sec: 2048, wx_sec: 512 })).toEqual({
      readBytesPerSec: 2048,
      writeBytesPerSec: 512,
    });
  });

  it('treatsNullRatesAsZero', () => {
    expect(readDisk({ rx_sec: null, wx_sec: null })).toEqual({
      readBytesPerSec: 0,
      writeBytesPerSec: 0,
    });
  });

  it('returnsUndefinedWhenStatsAreAbsent', () => {
    expect(readDisk(null)).toBeUndefined();
  });
});

describe('pickGpu', () => {
  it('takesTheFirstControllerReportingUtilisation', () => {
    expect(pickGpu([{ utilizationGpu: null }, { utilizationGpu: 42 }])).toEqual({
      available: true,
      percent: 42,
    });
  });

  it('clampsUtilisationToThe0to100Range', () => {
    expect(pickGpu([{ utilizationGpu: 140 }]).percent).toBe(100);
  });

  it('reportsUnavailableWhenNoControllerHasAReading', () => {
    expect(pickGpu([{ utilizationGpu: null }, {}])).toEqual({ available: false, percent: 0 });
  });
});

describe('readAppUsage', () => {
  it('sumsProcessCpuAndNormalisesByCoreCount', () => {
    // Two processes at 200% + 40% of a single core, across 4 cores → (240 / 4) = 60% of the machine.
    const usage: AppUsageMetric = readAppUsage(
      [
        { cpu: { percentCPUUsage: 200 }, memory: { workingSetSize: 0 } },
        { cpu: { percentCPUUsage: 40 } },
      ],
      4,
      0,
    );
    expect(usage.cpuPercent).toBe(60);
  });

  it('sumsWorkingSetsToBytesAndAPercentageOfTotalMemory', () => {
    // workingSetSize is in kilobytes; 1,048,576 KB = 1 GiB, of a 4 GiB machine → 25%.
    const usage: AppUsageMetric = readAppUsage(
      [{ memory: { workingSetSize: 1_048_576 } }],
      8,
      4 * 1024 * 1024 * 1024,
    );
    expect(usage.memoryBytes).toBe(1024 * 1024 * 1024);
    expect(usage.memoryPercent).toBe(25);
  });

  it('clampsCpuShareToThe0to100RangeAndGuardsZeroCores', () => {
    const usage: AppUsageMetric = readAppUsage([{ cpu: { percentCPUUsage: 800 } }], 0, 0);
    expect(usage.cpuPercent).toBe(100);
  });

  it('treatsMissingAndNegativeFieldsAsZero', () => {
    const usage: AppUsageMetric = readAppUsage(
      [{}, { cpu: { percentCPUUsage: -5 }, memory: { workingSetSize: null } }],
      4,
      1024,
    );
    expect(usage).toEqual({ cpuPercent: 0, memoryBytes: 0, memoryPercent: 0 });
  });
});

describe('parseIoregGpu', () => {
  it('readsTheLiveDeviceUtilisationNotTheAccumulator', () => {
    // The cumulative Accum dict comes first with a stale value; the live dict must win.
    const output: string =
      '"PerformanceStatisticsAccum" = {"Device Utilization %"=0,"GPU Activity(%)"=0}\n' +
      '"PerformanceStatistics" = {"Device Utilization %"=37,"GPU Activity(%)"=41}';
    expect(parseIoregGpu(output)).toEqual({ available: true, percent: 37 });
  });

  it('fallsBackToGpuActivityWhenDeviceUtilisationIsAbsent', () => {
    const output: string = '"PerformanceStatistics" = {"GPU Activity(%)"=52}';
    expect(parseIoregGpu(output)).toEqual({ available: true, percent: 52 });
  });

  it('clampsToThe0to100Range', () => {
    const output: string = '"PerformanceStatistics" = {"Device Utilization %"=250}';
    expect(parseIoregGpu(output).percent).toBe(100);
  });

  it('reportsUnavailableWhenNoUtilisationIsPresent', () => {
    expect(parseIoregGpu('no stats here')).toEqual({ available: false, percent: 0 });
  });
});

describe('readInterfaces', () => {
  it('listsNamedInterfaces_busiestFirst', () => {
    expect(
      readInterfaces([
        { iface: 'lo0', rx_sec: 10, tx_sec: 10 },
        { iface: 'en0', rx_sec: 900, tx_sec: 100 },
        { rx_sec: 5000, tx_sec: 5000 },
        { iface: 'utun3', rx_sec: null, tx_sec: null },
      ]),
    ).toEqual([
      { name: 'en0', rxBytesPerSec: 900, txBytesPerSec: 100 },
      { name: 'lo0', rxBytesPerSec: 10, txBytesPerSec: 10 },
      { name: 'utun3', rxBytesPerSec: 0, txBytesPerSec: 0 },
    ]);
  });
});

describe('readMemoryDetail', () => {
  it('mapsAvailableAndSwap', () => {
    expect(readMemoryDetail({ available: 800, swapused: 20, swaptotal: 100 })).toEqual({
      availableBytes: 800,
      swapUsedBytes: 20,
      swapTotalBytes: 100,
    });
  });
});

describe('readVolumes', () => {
  it('keepsUserVolumes_leavingOutVirtualSystemAndEmptyOnes', () => {
    expect(
      readVolumes([
        { mount: '/', type: 'apfs', size: 1000, used: 400 },
        { mount: '/System/Volumes/Data', type: 'apfs', size: 1000, used: 400 },
        { mount: '/System/Library/AssetsV2/x/.AssetData', type: 'apfs', size: 4, used: 1 },
        { mount: '/dev', type: 'devfs', size: 10, used: 10 },
        { mount: '/run', type: 'tmpfs', size: 10, used: 1 },
        { mount: '/Volumes/Backup', type: 'hfs', size: 2000, used: 2500 },
        { mount: '/Volumes/Empty', type: 'msdos', size: 0, used: 0 },
        { mount: '/', type: 'apfs', size: 1000, used: 400 },
      ]),
    ).toEqual([
      { mount: '/', type: 'apfs', sizeBytes: 1000, usedBytes: 400 },
      // Used is held to the size, so a volume never reads as more than full.
      { mount: '/Volumes/Backup', type: 'hfs', sizeBytes: 2000, usedBytes: 2000 },
    ]);
  });

  it('takesUsed_asTheSpaceNotAvailable_whereTheOsReportsIt', () => {
    // macOS's sealed system volume: a few GB of its own, but the container is mostly full.
    expect(
      readVolumes([{ mount: '/', type: 'apfs', size: 1000, used: 10, available: 300 }]),
    ).toEqual([{ mount: '/', type: 'apfs', sizeBytes: 1000, usedBytes: 700 }]);
  });
});

describe('readGpus', () => {
  it('namesEachController_withItsDedicatedMemoryInBytes', () => {
    expect(
      readGpus([
        { model: 'Radeon Pro W5700X', vendor: 'AMD', vram: 16_384 },
        { model: 'Intel UHD', vendor: 'Intel', vram: 0 },
        { vendor: 'Unknown' },
      ]),
    ).toEqual([
      { model: 'Radeon Pro W5700X', vendor: 'AMD', memoryBytes: 16_384 * 1024 * 1024 },
      { model: 'Intel UHD', vendor: 'Intel' },
    ]);
  });
});

describe('readCaches', () => {
  const cache: CpuCacheStat = {
    l1d: 32 * 1024,
    l1i: 32 * 1024,
    l2: 1024 * 1024,
    l3: 33 * 1024 * 1024,
  };

  it('multipliesMacOsPerCoreCaches_outToTheProcessor', () => {
    expect(readCaches(cache, 'darwin', 24)).toEqual([
      { level: 'L1', totalBytes: 64 * 1024 * 24, perCoreBytes: 64 * 1024 },
      { level: 'L2', totalBytes: 1024 * 1024 * 24, perCoreBytes: 1024 * 1024 },
      { level: 'L3', totalBytes: 33 * 1024 * 1024 },
    ]);
  });

  it('takesOtherPlatformsReadings_asTotals', () => {
    expect(readCaches(cache, 'win32', 24)[0]).toEqual({ level: 'L1', totalBytes: 64 * 1024 });
  });

  it('leavesOutALevelNotReported', () => {
    expect(readCaches({ l1d: null, l1i: null, l2: 0, l3: 8 }, 'linux', 4)).toEqual([
      { level: 'L3', totalBytes: 8 },
    ]);
  });
});

describe('architectureName', () => {
  it('namesTheArchitectureAsPeopleKnowIt', () => {
    expect(architectureName('x64')).toBe('x86_64');
    expect(architectureName('arm64')).toBe('arm64');
  });
});
