import { GpuReading, SystemInfo } from '@shared/api/system-monitor-channels';

/**
 * A reading from this Mac's AMD Radeon RX 6900 XT, for the GPU view's specs.
 */
export const GPU_READING: GpuReading = {
  timestamp: '2026-11-14T12:00:00.000Z',
  utilisationPercent: 2,
  memoryUsedBytes: 2 * 1024 ** 3,
  temperatureC: 62,
  powerWatts: 71,
  fanRpm: 589,
  fanPercent: 17,
  coreClockMhz: 124,
  memoryClockMhz: 1988,
  engines: [
    { kind: '3d', label: '3D / Graphics', value: 106, unit: 'commands' },
    { kind: 'decode', label: 'Video Decode', value: 0, unit: 'commands' },
  ],
  processes: [
    { pid: 202, name: 'WindowServer', gpuPercent: 1.5 },
    { pid: 1316, gpuPercent: 0.4 },
  ],
};

/**
 * This Mac described, its GPU with its driver, architecture and bus.
 */
export const GPU_MACHINE: SystemInfo = {
  cpuModel: 'CPU',
  logicalCores: 1,
  totalMemoryBytes: 1,
  os: 'macOS',
  architecture: 'x86_64',
  caches: [],
  memoryModules: [],
  gpus: [
    {
      model: 'AMD Radeon RX 6900 XT',
      vendor: 'AMD',
      memoryBytes: 16 * 1024 ** 3,
      driver: 'AMDRadeonX6000 7.0.1',
      architecture: 'RDNA 2',
      bus: 'PCIe ×16',
    },
  ],
};
