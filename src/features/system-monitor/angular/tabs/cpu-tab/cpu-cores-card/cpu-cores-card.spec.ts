import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SystemMonitorReadings } from '../../../readings/system-monitor-readings';
import { CpuCoresCard } from './cpu-cores-card';

describe('CpuCoresCard', () => {
  let fixture: ComponentFixture<CpuCoresCard>;
  let host: HTMLElement;
  let readings: SystemMonitorReadings;

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

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CpuCoresCard],
      providers: [SystemMonitorReadings],
    }).compileComponents();
    readings = TestBed.inject(SystemMonitorReadings);
    fixture = TestBed.createComponent(CpuCoresCard);
    host = fixture.nativeElement as HTMLElement;
    readings.accept({
      timestamp: 't',
      cpu: 10,
      memory: { usedBytes: 1, totalBytes: 2, percent: 50 },
      cores: [51, 0, 19],
    });
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => {
    globalThis.localStorage?.clear();
  });

  it('showsEveryCore_asAGridOfTiles_countedInItsTitle', () => {
    expect(host.querySelector('article')?.getAttribute('aria-label')).toBe(
      'Utilisation by Core (3)',
    );
    const tiles: NodeListOf<Element> = host.querySelectorAll(
      '[data-testid="cpu-cores-grid"] > div',
    );
    expect(tiles).toHaveLength(3);
    expect(tiles[0].getAttribute('aria-label')).toBe('Core 1: 51%');
  });

  it('switchesToAList_withABarPerCore', async () => {
    button('List').click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host.querySelector('[data-testid="cpu-cores-grid"]')).toBeNull();
    const meters: NodeListOf<Element> = host.querySelectorAll(
      '[data-testid="cpu-cores-list"] [role="meter"]',
    );
    expect(meters).toHaveLength(3);
    expect(meters[2].getAttribute('aria-valuenow')).toBe('19');
    expect(button('List').getAttribute('aria-pressed')).toBe('true');
  });
});
