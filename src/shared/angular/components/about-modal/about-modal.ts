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
          <header class="about__header">
            <img class="about__logo" src="icon.svg" alt="" draggable="false" />
            <h2 class="about__title">ONIXLabs Studio</h2>
          </header>
          <p class="about__blurb">
            An Agentic Development Environment — a workbench where humans and AI agents develop
            together.
          </p>
          <dl class="about__facts">
            <div class="about__fact">
              <dt>Studio</dt>
              <dd>{{ facts().studio }}</dd>
            </div>
            <div class="about__fact">
              <dt>Plugin API</dt>
              <dd>{{ facts().pluginApi }}</dd>
            </div>
            <div class="about__fact">
              <dt>Catalogue revision</dt>
              <dd>{{ revision() }}</dd>
            </div>
            <div class="about__fact">
              <dt>Electron</dt>
              <dd>{{ facts().electron }}</dd>
            </div>
            <div class="about__fact">
              <dt>Chromium</dt>
              <dd>{{ facts().chromium }}</dd>
            </div>
            <div class="about__fact">
              <dt>Node</dt>
              <dd>{{ facts().node }}</dd>
            </div>
            <div class="about__fact">
              <dt>Platform</dt>
              <dd>{{ facts().platform }}</dd>
            </div>
          </dl>
          <p class="about__licence">MIT licensed · Copyright © 2026 ONIXLabs</p>
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
        gap: 1rem;
      }

      // The identity block is the welcome screen's, scaled to a dialog: the same logo beside the same
      // weight and letter-spacing, so the two surfaces that introduce the application agree.
      .about__header {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.9rem;
        user-select: none;
      }

      .about__logo {
        flex: none;
        inline-size: 3.5rem;
        block-size: 3.5rem;
        user-select: none;
      }

      .about__title {
        margin: 0;
        font-size: 1.45rem;
        font-weight: 500;
        letter-spacing: -0.01em;
      }

      .about__blurb {
        margin: 0;
        text-align: center;
        font-size: 0.85rem;
        line-height: 1.5;
        color: var(--muted-foreground-color, var(--body-foreground-color));
      }

      // A table in everything but element: no borders, no separators — the label reads from the left
      // and the version lands on the right, so the numbers line up as a column the eye can scan.
      .about__facts {
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
        margin: 0;
        font-size: 0.85rem;
      }

      .about__fact {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 1.5rem;
      }

      .about__fact dt {
        color: var(--muted-foreground-color, var(--body-foreground-color));
      }

      .about__fact dd {
        margin: 0;
        font-family: var(--font-mono);
        text-align: end;
        overflow-wrap: anywhere;
      }

      .about__licence {
        margin: 0;
        text-align: center;
        font-size: 0.78rem;
        color: var(--muted-foreground-color, var(--body-foreground-color));
      }

      .about__actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.6rem;
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
