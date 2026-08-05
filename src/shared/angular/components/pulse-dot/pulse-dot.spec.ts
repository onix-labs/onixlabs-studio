import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { PulseDot } from './pulse-dot';

describe('PulseDot', () => {
  let fixture: ComponentFixture<PulseDot>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [PulseDot] }).compileComponents();
    fixture = TestBed.createComponent(PulseDot);
    host = fixture.nativeElement as HTMLElement;
  });

  /**
   * Applies inputs and renders.
   * @param inputs The inputs to set.
   */
  function render(inputs: Record<string, unknown> = {}): void {
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    fixture.detectChanges();
  }

  it('tone_whenUnstated_isNeutral', () => {
    render();

    expect(host.classList.contains('pulse-dot--neutral')).toBe(true);
    expect(host.classList.contains('pulse-dot--pulsing')).toBe(false);
  });

  it('tone_whenStated_marksTheHost_soTheStylesheetColoursIt', () => {
    render({ tone: 'danger' });
    expect(host.classList.contains('pulse-dot--danger')).toBe(true);

    render({ tone: 'accent' });
    expect(host.classList.contains('pulse-dot--accent')).toBe(true);
    expect(host.classList.contains('pulse-dot--danger')).toBe(false);
  });

  it('pulse_whenSet_marksTheHost_soTheStylesheetAnimatesTheRing', () => {
    render({ pulse: true });

    expect(host.classList.contains('pulse-dot--pulsing')).toBe(true);
  });

  it('size_setsTheDiameterCustomProperty', () => {
    render({ size: 0.45 });

    expect(host.style.getPropertyValue('--pulse-dot-size')).toBe('0.45rem');
  });

  it('isHiddenFromAssistiveTech_asAPurelyVisualIndicator', () => {
    render();

    expect(host.getAttribute('aria-hidden')).toBe('true');
  });
});
