import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { RadialMeter } from './radial-meter';

describe('RadialMeter', () => {
  let fixture: ComponentFixture<RadialMeter>;
  let host: HTMLElement;

  /**
   * Shows a reading.
   * @param percent The reading.
   */
  async function show(percent: number): Promise<void> {
    fixture.componentRef.setInput('percent', percent);
    fixture.componentRef.setInput('label', 'In Use');
    fixture.detectChanges();
    await fixture.whenStable();
  }

  /**
   * Gets the meter.
   * @returns Returns the meter element.
   */
  function meter(): HTMLElement {
    const element: HTMLElement | null = host.querySelector('[role="meter"]');
    if (element === null) {
      throw new Error('No meter');
    }
    return element;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [RadialMeter] }).compileComponents();
    fixture = TestBed.createComponent(RadialMeter);
    host = fixture.nativeElement as HTMLElement;
  });

  it('statesTheReadingAndWhatItIs', async () => {
    await show(19.4);

    expect(host.textContent).toContain('19%');
    expect(host.textContent).toContain('In Use');
    expect(meter().getAttribute('aria-label')).toBe('In Use: 19%');
  });

  it('saysHowSevere_inWordsAsWellAsColour', async () => {
    await show(85);
    expect(meter().getAttribute('aria-label')).toBe('In Use: 85%, high');

    await show(96);
    expect(meter().getAttribute('aria-label')).toBe('In Use: 96%, critically high');
  });

  it('holdsTheReadingToTheMeter', async () => {
    await show(140);
    expect(host.textContent).toContain('100%');
  });

  it('nestsAnInnerReading_namedAfterTheOuterOne', async () => {
    fixture.componentRef.setInput('innerPercent', 0.3);
    fixture.componentRef.setInput('innerLabel', 'Studio');
    await show(23);

    expect(meter().getAttribute('aria-label')).toBe('In Use: 23%; Studio: 0.3%');
    expect(host.textContent).toContain('0.3% Studio');
    expect(host.querySelectorAll('circle')).toHaveLength(4);
  });

  it('drawsNoFill_forAnEmptyReading_soARoundCapDoesNotReadAsADot', async () => {
    await show(0);

    expect(host.querySelectorAll('circle')).toHaveLength(1);
  });
});
