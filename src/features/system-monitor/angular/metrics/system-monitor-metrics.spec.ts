import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { Bridge } from '@shared/api/bridge';
import { MetricsSample, SystemMonitorChannel } from '@shared/api/system-monitor-channels';
import { SystemMonitorMetrics } from './system-monitor-metrics';

describe('SystemMonitorMetrics', () => {
  let sent: string[];
  let subscribed: { channel: string; listener: (...args: unknown[]) => void } | null;

  /**
   * Installs a recording bridge on the window and resolves the service.
   * @returns Returns the resolved {@link SystemMonitorMetrics} instance.
   */
  function setup(): SystemMonitorMetrics {
    sent = [];
    subscribed = null;
    const bridge: Pick<Bridge, 'send' | 'on'> = {
      send: (channel: string): void => {
        sent.push(channel);
      },
      on: (channel: string, listener: (...args: unknown[]) => void): (() => void) => {
        subscribed = { channel, listener };
        return (): void => {
          // Not exercised here.
        };
      },
    };
    (window as { bridge?: unknown }).bridge = bridge;
    return TestBed.inject(SystemMonitorMetrics);
  }

  afterEach(() => {
    delete (window as { bridge?: unknown }).bridge;
  });

  it('start_sendsTheStartChannel', () => {
    setup().start();
    expect(sent).toEqual([SystemMonitorChannel.Start]);
  });

  it('stop_sendsTheStopChannel', () => {
    setup().stop();
    expect(sent).toEqual([SystemMonitorChannel.Stop]);
  });

  it('onSample_subscribesToTheSampleChannelAndUnwrapsThePayload', () => {
    const seen: MetricsSample[] = [];
    setup().onSample((sample: MetricsSample): void => {
      seen.push(sample);
    });
    expect(subscribed?.channel).toBe(SystemMonitorChannel.Sample);
    const sample: MetricsSample = {
      timestamp: 't',
      cpu: 10,
      memory: { usedBytes: 1, totalBytes: 2, percent: 50 },
    };
    subscribed?.listener(sample);
    expect(seen).toEqual([sample]);
  });

  it('withoutBridge_isASafeNoOp', () => {
    delete (window as { bridge?: unknown }).bridge;
    const metrics: SystemMonitorMetrics = TestBed.inject(SystemMonitorMetrics);
    expect((): void => {
      metrics.start();
      metrics.stop();
    }).not.toThrow();
    expect(
      metrics.onSample((): void => {
        // A no-op listener; without a bridge nothing will invoke it.
      }),
    ).toBeTypeOf('function');
  });
});
