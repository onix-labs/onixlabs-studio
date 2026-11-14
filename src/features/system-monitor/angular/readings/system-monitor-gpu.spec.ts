import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GPU_READING } from '../tabs/gpu-tab/gpu-test-reading';
import { GPU_LIVE_READINGS, GpuEngineHistory, SystemMonitorGpu } from './system-monitor-gpu';

describe('SystemMonitorGpu', () => {
  let gpu: SystemMonitorGpu;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [SystemMonitorGpu] });
    gpu = TestBed.inject(SystemMonitorGpu);
  });

  afterEach(() => {
    globalThis.localStorage?.clear();
    TestBed.resetTestingModule();
  });

  it('keepsTheRecentReadings_andEachEnginesActivity', () => {
    gpu.accept({ ...GPU_READING, utilisationPercent: 1 });
    gpu.accept(GPU_READING);

    expect(gpu.utilisationHistory()).toEqual([1, 2]);
    expect(gpu.memoryHistory()).toEqual([2 * 1024 ** 3, 2 * 1024 ** 3]);
    expect(
      gpu
        .engines()
        .map(
          (history: GpuEngineHistory): string =>
            `${history.engine.label}: ${history.values.join(',')}`,
        ),
    ).toEqual(['3D / Graphics: 106,106', 'Video Decode: 0,0']);
  });

  it('holdsTheReadingsToFiveMinutes', () => {
    for (let index: number = 0; index < GPU_LIVE_READINGS + 10; index += 1) {
      gpu.accept(GPU_READING);
    }

    expect(gpu.readings()).toHaveLength(GPU_LIVE_READINGS);
  });
});
