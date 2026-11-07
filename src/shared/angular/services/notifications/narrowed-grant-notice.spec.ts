import { TestBed } from '@angular/core/testing';
import { Ai } from '@shared/angular/services/ai/ai';
import type { Notification } from '@shared/angular/services/notifications/notifications';
import { Notifications } from '@shared/angular/services/notifications/notifications';
import { SettingsNavigation } from '@shared/angular/services/settings-navigation/settings-navigation';
import { NarrowedGrantNotice } from './narrowed-grant-notice';

describe('NarrowedGrantNotice', () => {
  /**
   * Starts the notice with a client that reports the given tools.
   * @param tools The tools the store dropped grants for.
   * @param open Records a deep link.
   * @returns Resolves once the notice has had its chance to raise.
   */
  async function start(tools: readonly string[], open: (section: string) => void): Promise<void> {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: Ai,
          useValue: {
            client: {
              takeNarrowedGrants: (): Promise<readonly string[]> => Promise.resolve(tools),
            },
          },
        },
        { provide: SettingsNavigation, useValue: { open } },
      ],
    });
    TestBed.inject(NarrowedGrantNotice);
    await Promise.resolve();
    await Promise.resolve();
  }

  it('saysWhichToolLostItsGrant_andLinksToTheList', async () => {
    const opened: string[] = [];

    await start(['Bash'], (section: string): void => void opened.push(section));

    const toasts: readonly Notification[] = TestBed.inject(Notifications).toasts();
    expect(toasts).toHaveLength(1);
    expect(toasts[0].detail).toContain('Bash could run any command');
    expect(toasts[0].detail).toContain('a run outside the sandbox asks separately');
    expect(toasts[0].sticky).toBe(true);

    toasts[0].actions[0].run();

    expect(opened).toEqual(['ai-security']);
  });

  it('saysNothing_whenNoGrantWasDropped', async () => {
    await start([], (): void => undefined);

    expect(TestBed.inject(Notifications).toasts()).toEqual([]);
  });

  it('saysNothing_outsideStudio', async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: Ai, useValue: { client: undefined } }],
    });

    TestBed.inject(NarrowedGrantNotice);
    await Promise.resolve();

    expect(TestBed.inject(Notifications).toasts()).toEqual([]);
  });
});
