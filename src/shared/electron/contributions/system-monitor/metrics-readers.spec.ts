import { describe, expect, it } from 'vitest';
import { AppUsageMetric } from '@shared/api/system-monitor-channels';
import { parseIoregGpu, pickGpu, readAppUsage, readDisk, sumNetwork } from './metrics-readers';

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
