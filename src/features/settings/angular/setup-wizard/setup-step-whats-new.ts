import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ReleaseHighlights } from '@shared/api/release-highlights';
import { SetupWizard } from '@shared/angular/services/setup-wizard/setup-wizard';

/**
 * The setup wizard's What's New step: what the release the user is arriving at actually brought them.
 *
 * Every release the user is moving across is reported, oldest first, not just the last hop. Someone
 * going from a beta three versions back to the stable release missed all of it at once, and telling
 * them only about the final step would be the same silence the wizard exists to end.
 *
 * The step only runs when there is something to report, so this never renders an empty state — but it
 * still states the version, because "what changed" is meaningless without saying changed *to what*.
 */
@Component({
  selector: 'app-setup-step-whats-new',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './setup-step-whats-new.scss',
  template: `
    @for (release of wizard.highlights; track release.version) {
      <section class="release">
        <h3 class="release__version">{{ release.version }}</h3>
        <ul class="release__headlines">
          @for (headline of release.headlines; track headline.title) {
            <li class="release__headline">
              <span class="release__headline-title">{{ headline.title }}</span>
              <span class="release__headline-detail">{{ headline.detail }}</span>
            </li>
          }
        </ul>
      </section>
    }
  `,
})
export class SetupStepWhatsNew {
  /**
   * Holds the wizard, which resolved the releases being moved across when it decided to run.
   */
  protected readonly wizard: SetupWizard = inject(SetupWizard);

  /**
   * Gets the releases to report, exposed for the template's type inference.
   */
  protected readonly releases: readonly ReleaseHighlights[] = this.wizard.highlights;
}
