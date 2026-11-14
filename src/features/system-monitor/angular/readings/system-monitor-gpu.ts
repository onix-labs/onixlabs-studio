import { computed, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { Settings } from '@shared/angular/services/settings/settings';
import {
  GPU_SAMPLE_INTERVAL_MS,
  GpuEngineReading,
  GpuReading,
} from '@shared/api/system-monitor-channels';

/**
 * The most live readings kept: five minutes at the GPU view's reading pace, the longest span the
 * history card draws from them rather than from the backend's history.
 */
export const GPU_LIVE_READINGS: number = Math.ceil((5 * 60_000) / GPU_SAMPLE_INTERVAL_MS);

/**
 * Describes one engine's recent activity.
 */
export interface GpuEngineHistory {
  /**
   * Gets the engine's latest reading.
   */
  readonly engine: GpuEngineReading;

  /**
   * Gets its recent activity, oldest first, in the engine's unit.
   */
  readonly values: readonly number[];
}

/**
 * Holds one System Monitor view's GPU readings: the latest, and the recent history of the figures the
 * GPU view graphs — utilisation, video memory, each engine — kept for five minutes while the GPU view
 * is open. Provided by the view; it feeds readings through {@link accept}.
 */
@Service({ autoProvided: false })
export class SystemMonitorGpu {
  /**
   * Holds the settings, read for Graph History.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the latest reading, or null before the first arrives.
   */
  public readonly latest: WritableSignal<GpuReading | null> = signal<GpuReading | null>(null);

  /**
   * Holds the recent readings, oldest first, up to {@link GPU_LIVE_READINGS}.
   */
  public readonly readings: WritableSignal<readonly GpuReading[]> = signal<readonly GpuReading[]>(
    [],
  );

  /**
   * Gets how many of the recent readings a graph over Graph History draws.
   */
  private readonly graphLength: Signal<number> = computed((): number =>
    Math.min(
      GPU_LIVE_READINGS,
      Math.ceil(
        (this.settings.value('systemMonitor.graphHistoryMinutes')() * 60_000) /
          GPU_SAMPLE_INTERVAL_MS,
      ),
    ),
  );

  /**
   * Gets the readings a graph over Graph History draws.
   */
  private readonly graphed: Signal<readonly GpuReading[]> = computed((): readonly GpuReading[] =>
    this.readings().slice(-this.graphLength()),
  );

  /**
   * Gets the recent utilisation, oldest first, over Graph History.
   */
  public readonly utilisationHistory: Signal<readonly number[]> = computed((): readonly number[] =>
    this.graphed()
      .map((reading: GpuReading): number | undefined => reading.utilisationPercent)
      .filter((value: number | undefined): value is number => value !== undefined),
  );

  /**
   * Gets the recent video memory in use, oldest first, over Graph History.
   */
  public readonly memoryHistory: Signal<readonly number[]> = computed((): readonly number[] =>
    this.graphed()
      .map((reading: GpuReading): number | undefined => reading.memoryUsedBytes)
      .filter((value: number | undefined): value is number => value !== undefined),
  );

  /**
   * Gets each engine the latest reading reports, with its recent activity over Graph History.
   */
  public readonly engines: Signal<readonly GpuEngineHistory[]> = computed(
    (): readonly GpuEngineHistory[] => {
      const latest: GpuReading | null = this.latest();
      if (latest === null) {
        return [];
      }
      const readings: readonly GpuReading[] = this.graphed();
      return latest.engines.map((engine: GpuEngineReading): GpuEngineHistory => ({
        engine,
        values: readings.map(
          (reading: GpuReading): number =>
            reading.engines.find(
              (candidate: GpuEngineReading): boolean =>
                candidate.kind === engine.kind && candidate.label === engine.label,
            )?.value ?? 0,
        ),
      }));
    },
  );

  /**
   * Records one reading.
   * @param reading The reading.
   */
  public accept(reading: GpuReading): void {
    this.latest.set(reading);
    this.readings.update((readings: readonly GpuReading[]): readonly GpuReading[] =>
      [...readings, reading].slice(-GPU_LIVE_READINGS),
    );
  }
}
