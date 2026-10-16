import {
  ChangeDetectionStrategy,
  Component,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
} from '@angular/core';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';
import { Button } from '@shared/angular/components/forms/button/button';
import { ButtonRow } from '@shared/angular/components/forms/button-row/button-row';
import type { RepositoryTrustQuestion } from '@shared/angular/services/repository-trust/repository-trust';

/**
 * The question a repository is asked before version control first runs in it.
 *
 * The wording says what is at stake in plain terms: a repository can hold settings and scripts that
 * its tool runs the moment it looks at the folder, so the question is about where the repository came
 * from, not about Studio. Not trusting is the safe answer and the first button, and closing the window
 * means the same thing.
 */
@Component({
  selector: 'app-repository-trust-modal',
  imports: [Modal, ModalContent, Button, ButtonRow],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (question(); as pending) {
      <app-modal
        [open]="true"
        [width]="32"
        ariaLabel="Do you trust this repository?"
        (dismiss)="declined.emit()"
      >
        <ng-template appModalContent>
          <div class="trust">
            <h2 class="trust__title">Do you trust this repository?</h2>

            <dl class="trust__facts">
              <dt>Repository</dt>
              <dd>{{ pending.name }}</dd>
              <dt>Folder</dt>
              <dd class="trust__path">{{ pending.root }}</dd>
            </dl>

            <p class="trust__body">
              A repository can hold settings and scripts that run on this computer the moment
              version control looks at it. Trust it only if you know where it came from.
            </p>
            <p class="trust__body">
              If you don't trust it, Studio leaves version control switched off in this folder. You
              can trust it later from the Repository panel.
            </p>

            <app-button-row class="trust__actions">
              <app-button variant="solid" label="Don't trust" (click)="declined.emit()" />
              <app-button label="Trust" (click)="accepted.emit()" />
            </app-button-row>
          </div>
        </ng-template>
      </app-modal>
    }
  `,
  styles: [
    `
      .trust {
        display: flex;
        flex-direction: column;
        gap: 0.9rem;
      }

      .trust__title {
        margin: 0;
        font-size: 1.05rem;
      }

      .trust__facts {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 0.3rem 0.9rem;
        margin: 0;
        font-size: 0.85rem;

        dt {
          color: var(--muted-foreground-color, var(--body-foreground-color));
        }

        dd {
          margin: 0;
        }
      }

      .trust__path {
        overflow-wrap: anywhere;
      }

      .trust__body {
        margin: 0;
        line-height: 1.5;
      }

      .trust__actions {
        margin-block-start: 0.4rem;
      }
    `,
  ],
})
export class RepositoryTrustModal {
  /**
   * Gets the repository being asked about, or null when nothing is being asked.
   */
  public readonly question: InputSignal<RepositoryTrustQuestion | null> =
    input.required<RepositoryTrustQuestion | null>();

  /**
   * Emitted when the user trusts the repository.
   */
  public readonly accepted: OutputEmitterRef<void> = output<void>();

  /**
   * Emitted when the user does not trust the repository, or dismisses the window. Nothing runs
   * either way, so the two are deliberately the same outcome.
   */
  public readonly declined: OutputEmitterRef<void> = output<void>();
}
