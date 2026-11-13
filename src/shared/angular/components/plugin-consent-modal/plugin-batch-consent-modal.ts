import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  Signal,
} from '@angular/core';
import { PluginSummary } from '@shared/api/plugin-channels';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';
import { Button } from '@shared/angular/components/forms/button/button';
import { ButtonRow } from '@shared/angular/components/forms/button-row/button-row';

/**
 * The terms several plugin updates are accepted under, asked once for Update All (#1451).
 *
 * The same consent each plugin's own window asks, in one question: the same statement of what Studio
 * checks and what it does not, and the list of what is about to change, each plugin with its version
 * before and after. Accepting it is accepting every update in the list; cancelling, or closing the
 * window, updates none of them.
 *
 * ⛔ New modal: awaiting Matthew's sign-off.
 */
@Component({
  selector: 'app-plugin-batch-consent-modal',
  imports: [Modal, ModalContent, Button, ButtonRow],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (plugins(); as pending) {
      <app-modal
        [open]="true"
        [width]="32"
        [frameless]="true"
        [ariaLabel]="title()"
        (dismiss)="declined.emit()"
      >
        <ng-template appModalContent>
          <div class="consent">
            <h2 class="consent__title">{{ title() }}</h2>

            <p class="consent__body">
              These are third-party software. Studio verifies that what it downloads is exactly what
              was pinned, and refuses it otherwise — but Studio does not review what the code does,
              and does not vet everyone who wrote it. Once updated each runs on this machine as you,
              and reads the projects you open with it.
            </p>

            <ul class="consent__list" aria-label="Updates">
              @for (plugin of pending; track plugin.id) {
                <li class="consent__item">
                  <span class="consent__name">{{ plugin.name }}</span>
                  <span class="consent__versions"
                    >{{ plugin.installedVersion }} → {{ plugin.version }}</span
                  >
                </li>
              }
            </ul>

            <app-button-row class="consent__actions">
              <app-button variant="solid" label="Update All" (click)="accepted.emit()" />
              <app-button variant="none" label="Cancel" (click)="declined.emit()" />
            </app-button-row>
          </div>
        </ng-template>
      </app-modal>
    }
  `,
  styles: [
    `
      .consent {
        display: flex;
        flex-direction: column;
        gap: 0.9rem;
      }

      .consent__title {
        margin: 0;
        font-size: 1.05rem;
      }

      .consent__body {
        margin: 0;
        line-height: 1.5;
      }

      .consent__list {
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
        max-block-size: 14rem;
        margin: 0;
        padding: 0;
        overflow-y: auto;
        list-style: none;
        font-size: 0.85rem;
      }

      .consent__item {
        display: flex;
        justify-content: space-between;
        gap: 0.9rem;
      }

      .consent__versions {
        color: var(--form-muted-foreground-color);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }

      .consent__actions {
        margin-block-start: 0.4rem;
      }
    `,
  ],
})
export class PluginBatchConsentModal {
  /**
   * Gets the plugins whose updates are being asked about, or null when nothing is being asked.
   */
  public readonly plugins: InputSignal<readonly PluginSummary[] | null> = input.required<
    readonly PluginSummary[] | null
  >();

  /**
   * Emitted when the terms are accepted and every update in the list should proceed.
   */
  public readonly accepted: OutputEmitterRef<void> = output<void>();

  /**
   * Emitted when the terms are declined or the window is dismissed. Nothing is fetched and nothing is
   * written, so declining and closing mean the same thing.
   */
  public readonly declined: OutputEmitterRef<void> = output<void>();

  /**
   * Gets the heading, which says how many plugins are about to change.
   */
  protected readonly title: Signal<string> = computed((): string => {
    const count: number = this.plugins()?.length ?? 0;
    return `Update ${count} ${count === 1 ? 'plugin' : 'plugins'}?`;
  });
}
