import { inject, Service, WritableSignal } from '@angular/core';
import { AiManagerNavigation } from '@shared/angular/services/ai-manager-navigation/ai-manager-navigation';
import { Log } from '@shared/angular/services/log/log';
import { Notifications } from '@shared/angular/services/notifications/notifications';
import { RememberedState } from '@shared/angular/services/remembered-state/remembered-state';
import { Persona } from './persona';

/**
 * Says once that prompt profiles became the persona (#1514). Each profile was converted into a locked
 * core entry and nothing was lost, but the Prompt Profiles page is gone, so a user who had profiles is
 * told where they went rather than left to find out.
 */
@Service()
export class PersonaConversionNotice {
  /**
   * Holds the persona, which reports how many profiles it converted.
   */
  private readonly persona: Persona = inject(Persona);

  /**
   * Holds the notification store the notice is raised to.
   */
  private readonly notifications: Notifications = inject(Notifications);

  /**
   * Holds the deep link to the Persona page.
   */
  private readonly navigation: AiManagerNavigation = inject(AiManagerNavigation);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds whether the notice has been raised, across launches, so it is said once.
   */
  private readonly told: WritableSignal<boolean> = inject(RememberedState).acrossLaunches<boolean>(
    'persona.conversionNoticeShown',
    false,
  );

  /**
   * Raises the notice, when there is anything to say.
   */
  public constructor() {
    void this.announce();
  }

  /**
   * Waits for the persona's first read, then says what was converted.
   * @returns Resolves once the notice is raised, or there was nothing to say.
   */
  private async announce(): Promise<void> {
    await this.persona.ready;
    const converted: number = this.persona.convertedProfiles();
    if (converted === 0 || this.told()) {
      return;
    }
    this.told.set(true);
    this.log.info('persona', `Told the user ${converted} prompt profile(s) became the persona`);
    this.notifications.notify({
      severity: 'info',
      title: 'Prompt profiles are now your persona',
      detail:
        `Your ${converted === 1 ? 'profile is' : `${converted} profiles are`} in the persona's core, ` +
        'locked, and agents get the same instructions as before. Your old profile files were left ' +
        'where they were.',
      sticky: true,
      actions: [{ label: 'Open Persona', run: (): void => this.navigation.open('persona') }],
    });
  }
}
