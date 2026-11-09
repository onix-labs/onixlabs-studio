import { Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Alert, AlertTone } from './alert';

/**
 * Hosts an alert with a projected message.
 */
@Component({
  imports: [Alert],
  template: `<app-alert [tone]="tone()">Saving replaces the layout.</app-alert>`,
})
class AlertHost {
  public readonly tone: WritableSignal<AlertTone> = signal<AlertTone>('info');
}

describe('Alert', () => {
  let fixture: ComponentFixture<AlertHost>;

  /**
   * Gets the alert element.
   * @returns Returns the element.
   */
  function alert(): HTMLElement {
    return (fixture.nativeElement as HTMLElement).querySelector('app-alert')!;
  }

  beforeEach(async () => {
    fixture = TestBed.createComponent(AlertHost);
    await fixture.whenStable();
  });

  it('showsItsMessage_besideAnIconHiddenFromScreenReaders', () => {
    expect(alert().querySelector('.alert__message')?.textContent).toBe(
      'Saving replaces the layout.',
    );
    expect(alert().querySelector('app-icon')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('isInformationUntilToldOtherwise', () => {
    expect(alert().classList.contains('alert--info')).toBe(true);
  });

  it.each<AlertTone>(['info', 'success', 'warning', 'danger'])(
    'drawsThe_%s_tone_andOnlyThatOne',
    async (tone: AlertTone) => {
      fixture.componentInstance.tone.set(tone);
      await fixture.whenStable();

      const tones: string[] = [...alert().classList].filter((name: string): boolean =>
        name.startsWith('alert--'),
      );
      expect(tones).toEqual([`alert--${tone}`]);
    },
  );

  it('givesEachToneItsOwnIcon', async () => {
    const icons: Set<string> = new Set<string>();
    for (const tone of ['info', 'success', 'warning', 'danger'] as const) {
      fixture.componentInstance.tone.set(tone);
      await fixture.whenStable();
      icons.add(alert().querySelector('app-icon')?.innerHTML ?? '');
    }

    expect(icons.size).toBe(4);
  });

  it('announcesADangerAtOnce_andAnythingElsePolitely', async () => {
    expect(alert().getAttribute('role')).toBe('status');

    fixture.componentInstance.tone.set('danger');
    await fixture.whenStable();

    expect(alert().getAttribute('role')).toBe('alert');
  });
});
