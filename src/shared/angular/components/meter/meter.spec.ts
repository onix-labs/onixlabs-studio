import { Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Meter, MeterTone } from './meter';

/**
 * Hosts a meter with writable inputs.
 */
@Component({
  imports: [Meter],
  template: `<app-meter [value]="value()" [tone]="tone()" ariaLabel="Progress" />`,
})
class Host {
  public readonly value: WritableSignal<number> = signal<number>(0);
  public readonly tone: WritableSignal<MeterTone> = signal<MeterTone>('accent');
}

describe('Meter', () => {
  let fixture: ComponentFixture<Host>;

  /**
   * Gets the meter's host element.
   * @returns Returns the element.
   */
  function meter(): HTMLElement {
    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    return host.querySelector<HTMLElement>('app-meter')!;
  }

  /**
   * Sets the value and renders.
   * @param value The value to show.
   */
  async function show(value: number): Promise<void> {
    fixture.componentInstance.value.set(value);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(() => {
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
  });

  it('exposesItsValueAsAPercentage', async () => {
    await show(0.426);

    expect(meter().getAttribute('role')).toBe('meter');
    expect(meter().getAttribute('aria-valuenow')).toBe('43');
    expect(meter().getAttribute('aria-label')).toBe('Progress');
    expect(meter().querySelector<HTMLElement>('.meter__fill')!.style.inlineSize).toBe('43%');
  });

  it('clampsValuesOutsideTheRange', async () => {
    await show(1.7);
    expect(meter().getAttribute('aria-valuenow')).toBe('100');

    await show(-0.2);
    expect(meter().getAttribute('aria-valuenow')).toBe('0');
  });

  it('treatsANonNumberAsEmpty', async () => {
    await show(Number.NaN);

    expect(meter().getAttribute('aria-valuenow')).toBe('0');
  });

  it('wearsItsTone', async () => {
    fixture.componentInstance.tone.set('success');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(meter().classList).toContain('meter--success');
  });
});
