import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AiManagerNavigation } from '@shared/angular/services/ai-manager-navigation/ai-manager-navigation';
import type { Notification } from '@shared/angular/services/notifications/notifications';
import { Notifications } from '@shared/angular/services/notifications/notifications';
import { Persona } from './persona';
import { PersonaConversionNotice } from './persona-conversion-notice';

describe('PersonaConversionNotice (#1514)', () => {
  afterEach(() => {
    localStorage.clear();
  });

  /**
   * Starts the notice over a persona that reports the given number of converted profiles.
   * @param converted How many profiles were converted.
   * @param open Records a deep link.
   * @returns Resolves once the notice has had its chance to raise.
   */
  async function start(converted: number, open: (section: string) => void): Promise<void> {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: Persona,
          useValue: { ready: Promise.resolve(), convertedProfiles: signal<number>(converted) },
        },
        { provide: AiManagerNavigation, useValue: { open } },
      ],
    });
    TestBed.inject(PersonaConversionNotice);
    await Promise.resolve();
    await Promise.resolve();
  }

  it('saysWhereTheProfilesWent_andLinksToThePersona', async () => {
    const opened: string[] = [];

    await start(2, (section: string): void => void opened.push(section));

    const toasts: readonly Notification[] = TestBed.inject(Notifications).toasts();
    expect(toasts).toHaveLength(1);
    expect(toasts[0].title).toBe('Prompt profiles are now your persona');
    expect(toasts[0].detail).toContain('2 profiles are');
    expect(toasts[0].sticky).toBe(true);

    toasts[0].actions[0].run();

    expect(opened).toEqual(['persona']);
  });

  it('saysNothing_whenNoProfileWasConverted', async () => {
    await start(0, (): void => undefined);

    expect(TestBed.inject(Notifications).toasts()).toEqual([]);
  });

  it('saysItOnce_acrossLaunches', async () => {
    await start(1, (): void => undefined);
    // The remembered flag is written by an effect; let it run before the next "launch".
    TestBed.tick();
    TestBed.resetTestingModule();

    await start(1, (): void => undefined);

    expect(TestBed.inject(Notifications).toasts()).toEqual([]);
  });
});
