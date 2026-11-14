import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SystemMonitorProcesses } from '../../../readings/system-monitor-processes';
import { SystemMonitorReadings } from '../../../readings/system-monitor-readings';
import { MEMORY_SAMPLE } from '../memory-test-sample';
import { MemoryHistoryCard } from './memory-history-card';

describe('MemoryHistoryCard', () => {
  let fixture: ComponentFixture<MemoryHistoryCard>;
  let host: HTMLElement;
  let readings: SystemMonitorReadings;
  let listing: SystemMonitorProcesses;

  /**
   * Settles the fixture after a change.
   */
  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MemoryHistoryCard],
      providers: [SystemMonitorReadings, SystemMonitorProcesses],
    }).compileComponents();
    readings = TestBed.inject(SystemMonitorReadings);
    listing = TestBed.inject(SystemMonitorProcesses);
    fixture = TestBed.createComponent(MemoryHistoryCard);
    host = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    globalThis.localStorage?.clear();
  });

  /**
   * Finds a button by its visible label.
   * @param label The label.
   * @returns Returns the button.
   */
  function button(label: string): HTMLButtonElement {
    const match: HTMLButtonElement | undefined = Array.from(
      host.querySelectorAll<HTMLButtonElement>('button'),
    ).find((element: HTMLButtonElement): boolean => element.textContent?.trim() === label);
    if (match === undefined) {
      throw new Error(`No button labelled "${label}"`);
    }
    return match;
  }

  it('graphsUsage_thenPressure_andSaysWhenNoSwapIsConfigured', async () => {
    readings.accept(MEMORY_SAMPLE);
    await settle();
    expect(host.querySelector('[aria-label="Legend"]')?.textContent).toContain('Studio');

    button('Pressure').click();
    await settle();
    expect(host.querySelector('[aria-label="Legend"]')).toBeNull();
    expect(button('Pressure').getAttribute('aria-pressed')).toBe('true');

    button('Swap').click();
    await settle();
    expect(host.textContent).toContain('No swap is configured.');
    expect(listing).toBeDefined();
  });
});
