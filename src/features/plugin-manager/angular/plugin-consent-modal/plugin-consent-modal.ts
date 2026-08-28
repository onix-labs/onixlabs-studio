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

/**
 * The terms a plugin is installed under, asked before anything is fetched.
 *
 * This is consent, not reassurance, and the wording is the feature. Verification proves a payload has
 * not been *tampered with* — it has never claimed the code is good, and for a dependency tree the code
 * arrives from many more people than the one named on the entry. So the text says what Studio does
 * check, what it does not, and what the thing will be able to reach once it runs.
 *
 * The provenance line is read off the pinned URLs rather than declared by the manifest, because what a
 * plugin says about itself is precisely the claim the user is being asked to weigh.
 */
@Component({
  selector: 'app-plugin-consent-modal',
  imports: [Modal, ModalContent, Button],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (plugin(); as pending) {
      <app-modal [open]="true" [width]="32" [ariaLabel]="title()" (dismiss)="declined.emit()">
        <ng-template appModalContent>
          <div class="consent">
            <h2 class="consent__title">{{ title() }}?</h2>

            <dl class="consent__facts">
              @if (pending.installedVersion; as installed) {
                <dt>Installed</dt>
                <dd>{{ installed }}</dd>
                <dt>Updating to</dt>
                <dd>{{ pending.version }}</dd>
              } @else {
                <dt>Version</dt>
                <dd>{{ pending.version }}</dd>
              }
              @if (origin(); as summary) {
                <dt>Downloads</dt>
                <dd>{{ summary }}</dd>
              }
            </dl>

            <p class="consent__body">
              This is third-party software. Studio verifies that what it downloads is exactly what
              was pinned, and refuses it otherwise — but Studio does not review what the code does,
              and does not vet everyone who wrote it.
            </p>
            <p class="consent__body">
              Once installed it runs on this machine as you, and reads the projects you open with
              it.
            </p>

            <div class="consent__actions">
              <app-button label="Cancel" (click)="declined.emit()" />
              <app-button variant="solid" [label]="confirmLabel()" (click)="accepted.emit()" />
            </div>
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

      .consent__facts {
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

      .consent__body {
        margin: 0;
        line-height: 1.5;
      }

      .consent__actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.6rem;
        margin-block-start: 0.4rem;
      }
    `,
  ],
})
export class PluginConsentModal {
  /**
   * Gets the plugin whose terms are being asked, or null when nothing is being asked.
   */
  public readonly plugin: InputSignal<PluginSummary | null> =
    input.required<PluginSummary | null>();

  /**
   * Emitted when the terms are accepted and the install should proceed.
   */
  public readonly accepted: OutputEmitterRef<void> = output<void>();

  /**
   * Emitted when the terms are declined or the window is dismissed. Nothing is fetched and nothing is
   * written, so declining and closing mean the same thing and are deliberately the same outcome.
   */
  public readonly declined: OutputEmitterRef<void> = output<void>();

  /**
   * Gets whether this is a new install or a replacement of one already accepted.
   */
  private readonly updating: Signal<boolean> = computed((): boolean => {
    const pending: PluginSummary | null = this.plugin();
    return pending !== null && pending.installedVersion !== null;
  });

  /**
   * Gets the heading, which names what is about to happen rather than assuming an install.
   */
  protected readonly title: Signal<string> = computed(
    (): string => `${this.updating() ? 'Update' : 'Install'} ${this.plugin()?.name ?? ''}`,
  );

  /**
   * Gets the confirming action's label.
   */
  protected readonly confirmLabel: Signal<string> = computed((): string =>
    this.updating() ? 'Accept and update' : 'Accept and install',
  );

  /**
   * Gets what actually arrives, in the terms the user is being asked to accept, or null when Studio
   * cannot describe the payload. Absent provenance is shown as nothing rather than as an assurance.
   */
  protected readonly origin: Signal<string | null> = computed((): string | null => {
    const pending: PluginSummary | null = this.plugin();
    if (pending?.origin == null || pending.origin.hosts.length === 0) {
      return null;
    }
    const packages: string =
      pending.origin.packageCount === 1 ? '1 package' : `${pending.origin.packageCount} packages`;
    return `${packages} from ${pending.origin.hosts.join(', ')}`;
  });
}
