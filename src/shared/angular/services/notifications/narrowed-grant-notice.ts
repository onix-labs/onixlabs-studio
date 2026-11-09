import { inject, Service } from '@angular/core';
import { Ai } from '@shared/angular/services/ai/ai';
import { Log } from '@shared/angular/services/log/log';
import { Notifications } from '@shared/angular/services/notifications/notifications';
import { SettingsNavigation } from '@shared/angular/services/settings-navigation/settings-navigation';

/**
 * Says once that an old tool-wide command grant has gone (#1164). "Always allow Bash" used to let every
 * command run without asking, and the store now drops such a grant. Nothing is deleted without the user
 * seeing it, so this says so at start-up rather than leaving them to notice that prompts came back.
 */
@Service()
export class NarrowedGrantNotice {
  /**
   * Holds the AI client the dropped grants are read through.
   */
  private readonly ai: Ai = inject(Ai);

  /**
   * Holds the notification store the notice is raised to.
   */
  private readonly notifications: Notifications = inject(Notifications);

  /**
   * Holds the deep link to the page listing what is still remembered.
   */
  private readonly navigation: SettingsNavigation = inject(SettingsNavigation);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Raises the notice, when there is anything to say.
   */
  public constructor() {
    void this.announce();
  }

  /**
   * Takes the dropped grants and says so. The take is once only, so the toast stays until dismissed.
   * @returns Resolves once the notice is raised, or there was nothing to say.
   */
  private async announce(): Promise<void> {
    const tools: readonly string[] = (await this.ai.client?.takeNarrowedGrants()) ?? [];
    if (tools.length === 0) {
      return;
    }
    this.log.info('notifications', 'Old tool-wide grants dropped', tools.join(', '));
    this.notifications.notify({
      severity: 'warning',
      title: 'An old permission no longer applies',
      detail:
        `${tools.join(', ')} could run any command without asking. Each command now asks, and a ` +
        'run outside the sandbox asks separately.',
      sticky: true,
      actions: [
        {
          label: 'Review',
          run: (): void => this.navigation.open('ai-security'),
        },
      ],
    });
  }
}
