import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  Signal,
} from '@angular/core';
import type { WritableSignal } from '@angular/core';
import { Button } from '@shared/angular/components/forms/button/button';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';
import { AboutFacts, Help } from '@shared/angular/services/help/help';

/**
 * What the running build is: Studio's own version, the contracts it implements, and the runtimes
 * underneath it — with a Copy button, because the first place these facts are needed is a bug report.
 *
 * Mounted once at the application root and driven by {@link Help}, since the entry that opens it lives
 * in the native menu and can only call back into the renderer.
 */
@Component({
  selector: 'app-about-modal',
  imports: [Modal, ModalContent, Button],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal
      [open]="help.aboutOpen()"
      [width]="26"
      ariaLabel="About ONIXLabs Studio"
      (dismiss)="close()"
    >
      <ng-template appModalContent>
        <div class="about">
          <h2 class="about__title">ONIXLabs Studio</h2>
          <p class="about__version">{{ facts().studio }}</p>
          <dl class="about__facts">
            <dt>Plugin API</dt>
            <dd>{{ facts().pluginApi }}</dd>
            <dt>Catalogue revision</dt>
            <dd>{{ revision() }}</dd>
            <dt>Electron</dt>
            <dd>{{ facts().electron }}</dd>
            <dt>Chromium</dt>
            <dd>{{ facts().chromium }}</dd>
            <dt>Node</dt>
            <dd>{{ facts().node }}</dd>
            <dt>Platform</dt>
            <dd>{{ facts().platform }}</dd>
          </dl>
          <p class="about__licence">MIT licensed. Copyright © 2026 ONIXLabs.</p>
          <div class="about__actions">
            <app-button
              [label]="copied() ? 'Copied' : 'Copy'"
              tooltip="Copy these versions, ready to paste into an issue"
              (click)="copy()"
            />
            <app-button variant="solid" label="Close" (click)="close()" />
          </div>
        </div>
      </ng-template>
    </app-modal>
  `,
  styles: [
    `
      .about {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .about__title {
        margin: 0;
        font-size: 1.1rem;
      }

      .about__version {
        margin: 0;
        font-family: var(--font-mono);
        color: var(--accent-color);
      }

      .about__facts {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 0.3rem 1rem;
        margin: 0;
        font-size: 0.85rem;
      }

      .about__facts dt {
        color: var(--muted-foreground-color, var(--body-foreground-color));
      }

      .about__facts dd {
        margin: 0;
        font-family: var(--font-mono);
        overflow-wrap: anywhere;
      }

      .about__licence {
        margin: 0;
        font-size: 0.8rem;
        color: var(--muted-foreground-color, var(--body-foreground-color));
      }

      .about__actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.6rem;
        margin-block-start: 0.2rem;
      }
    `,
  ],
})
export class AboutModal {
  /**
   * Holds the help service that owns the dialog's state and its facts.
   */
  protected readonly help: Help = inject(Help);

  /**
   * Holds whether the last copy succeeded, so the button can say so.
   */
  private readonly copiedRecently: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets the facts to show, re-read whenever the dialog opens so a revision that arrived late is not
   * missed.
   */
  protected readonly facts: Signal<AboutFacts> = computed((): AboutFacts => {
    this.help.aboutOpen();
    return this.help.facts();
  });

  /**
   * Gets whether the version summary was just copied.
   */
  protected readonly copied: Signal<boolean> = this.copiedRecently.asReadonly();

  /**
   * Gets the catalogue revision for display, standing in a dash when it is unknown.
   */
  protected readonly revision: Signal<string> = computed((): string => {
    const revision: number | null = this.facts().catalogueRevision;
    return revision === null ? '—' : `${revision}`;
  });

  /**
   * Copies the version summary to the clipboard, reporting the outcome on the button.
   */
  protected async copy(): Promise<void> {
    this.copiedRecently.set(await this.help.copySummary());
  }

  /**
   * Closes the dialog, clearing the copied state so it opens neutral next time.
   */
  protected close(): void {
    this.copiedRecently.set(false);
    this.help.hideAbout();
  }
}
