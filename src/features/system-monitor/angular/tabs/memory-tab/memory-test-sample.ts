import { MetricsSample } from '@shared/api/system-monitor-channels';

/**
 * A sample from a 256 GB Mac with its full memory breakdown, for the Memory view's specs.
 */
export const MEMORY_SAMPLE: MetricsSample = {
  timestamp: '2026-11-14T12:00:00.000Z',
  cpu: 5,
  memory: { usedBytes: 49 * 1024 ** 3, totalBytes: 256 * 1024 ** 3, percent: 19 },
  memoryDetail: {
    availableBytes: 207 * 1024 ** 3,
    swapUsedBytes: 0,
    swapTotalBytes: 0,
    appBytes: 36 * 1024 ** 3,
    wiredBytes: 10 * 1024 ** 3,
    compressedBytes: 512 * 1024 ** 2,
    cachedBytes: 22 * 1024 ** 3,
    freeBytes: 187.5 * 1024 ** 3,
    pageIns: 10243683,
    pageOuts: 0,
    pressure: { level: 'normal', percent: 4 },
  },
  app: { cpuPercent: 0.1, memoryBytes: 700 * 1024 ** 2, memoryPercent: 0.3 },
};
