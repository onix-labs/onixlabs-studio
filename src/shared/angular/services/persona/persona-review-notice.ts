import { DestroyRef, inject, Service } from '@angular/core';
import { AiManagerNavigation } from '@shared/angular/services/ai-manager-navigation/ai-manager-navigation';
import { CoreNotificationType } from '@shared/angular/services/notifications/core-notification-types';
import { Notifications } from '@shared/angular/services/notifications/notifications';
import { Pete, type PeteRunSummary } from './pete';

/**
 * The key the review notification is raised under, so a later batch updates it in place rather than
 * adding another (#1517).
 */
const REVIEW_KEY: string = 'persona.review';

/**
 * Tells the user when Pete has changes waiting for review (#1517): once per run that leaves any, as
 * one notification that a later run updates rather than repeats, with Review to open them. A type of
 * its own, so it can be sent to the history only, or switched off, like any other.
 */
@Service()
export class PersonaReviewNotice {
  /**
   * Holds Pete.
   */
  private readonly pete: Pete = inject(Pete);

  /**
   * Holds the notification store.
   */
  private readonly notifications: Notifications = inject(Notifications);

  /**
   * Holds the deep link to the Persona page.
   */
  private readonly navigation: AiManagerNavigation = inject(AiManagerNavigation);

  /**
   * Listens for Pete's runs.
   */
  public constructor() {
    const unlisten: () => void = this.pete.onFinished((summary: PeteRunSummary): void => {
      void this.announce(summary);
    });
    inject(DestroyRef).onDestroy(unlisten);
  }

  /**
   * Raises or updates the notification after a run that left changes waiting.
   * @param summary The run.
   * @returns Resolves once raised, or there was nothing to say.
   */
  private async announce(summary: PeteRunSummary): Promise<void> {
    if (summary.pending === 0) {
      return;
    }
    await this.pete.refresh();
    const waiting: number = this.pete.state().pending.length;
    if (waiting === 0) {
      return;
    }
    this.notifications.notify({
      severity: 'info',
      type: CoreNotificationType.PersonaReview,
      key: REVIEW_KEY,
      title: 'Pete has persona changes for you to review',
      detail: `${waiting} change${waiting === 1 ? '' : 's'} to what Studio knows about you ${waiting === 1 ? 'is' : 'are'} waiting. Agents don't use ${waiting === 1 ? 'it' : 'them'} until you approve.`,
      sticky: true,
      actions: [
        {
          label: 'Review',
          run: (): void => {
            this.navigation.open('persona');
            this.pete.openReview();
          },
        },
      ],
    });
  }
}
