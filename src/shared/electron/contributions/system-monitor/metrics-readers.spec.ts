import { describe, expect, it } from 'vitest';
import { pickGpu, readDisk, sumNetwork } from './metrics-readers';

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
    expect(sumNetwork([{ rx_sec: null, tx_sec: -1 }])).toEqual({ rxBytesPerSec: 0, txBytesPerSec: 0 });
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
    expect(readDisk({ rx_sec: null, wx_sec: null })).toEqual({ readBytesPerSec: 0, writeBytesPerSec: 0 });
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
