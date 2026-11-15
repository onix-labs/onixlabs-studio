import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SystemMonitorReadings } from '../../../../readings/system-monitor-readings';
import { CpuCard } from './cpu-card';

describe('CpuCard', () => {
  let fixture: ComponentFixture<CpuCard>;
  let host: HTMLElement;
  let readings: SystemMonitorReadings;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CpuCard],
      providers: [SystemMonitorReadings],
    }).compileComponents();
    readings = TestBed.inject(SystemMonitorReadings);
    fixture = TestBed.createComponent(CpuCard);
    host = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    globalThis.localStorage?.clear();
  });

  it('drawsAGraphPerCore_leavingTheProcessorsDetailsToTheCpuView', async () => {
    readings.setInfo({
      cpuModel: 'Test CPU',
      logicalCores: 4,
      physicalCores: 2,
      speedGhz: 2.7,
      totalMemoryBytes: 1,
      os: 'TestOS',
      architecture: 'x86_64',
      caches: [],
      gpus: [],
      memoryModules: [],
    });
    readings.accept({
      timestamp: 't',
      cpu: 6,
      memory: { usedBytes: 1, totalBytes: 2, percent: 50 },
      cores: [1, 2, 3, 24],
      app: { cpuPercent: 1, memoryBytes: 1, memoryPercent: 0 },
    });
    fixture.detectChanges();
    await fixture.whenStable();

    // The processor's model, speed and core counts are the CPU view's; the card is its load.
    expect(host.textContent).not.toContain('2.70 GHz');
    expect(host.querySelector('dl')).toBeNull();
    // The system's load and Studio's share each have a badge, and share the graph.
    expect(host.textContent).toContain('System');
    expect(host.textContent).toContain('Studio');
    // The badges name the graph's two lines, so it carries no legend.
    expect(host.querySelector('[aria-label="Legend"]')).toBeNull();
    expect(host.textContent).toContain('6%');
    const cores: NodeListOf<HTMLElement> = host.querySelectorAll(
      '[data-testid="cpu-card-cores"] > div',
    );
    expect(cores).toHaveLength(4);
    expect(cores[3].getAttribute('title')).toBe('Core 4: 24%');
  });
});
