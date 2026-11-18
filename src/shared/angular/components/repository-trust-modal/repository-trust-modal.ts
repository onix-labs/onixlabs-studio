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
import type { TrustQuestion } from '@shared/api/trust-channels';

/**
 * Asks whether the user trusts a folder (#1504): until they do, Studio shows its files and runs
 * nothing from it. It offers Trust, Don't Trust and, for an open workspace, Scan with AI, which has
 * a read-only agent look for code that would run before the user decides. Dismissing the window is
 * Don't Trust.
 *
 * Asked before a clone, it names the address the repository comes from and offers Decide Later in place
 * of Scan with AI, since there is nothing to read yet; dismissing it then clones nothing.
 */
@Component({
  selector: 'app-repository-trust-modal',
  imports: [Modal, ModalContent, Button, ButtonRow],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (question(); as pending) {
      <app-modal
        [open]="true"
        [width]="34"
        [frameless]="true"
        [ariaLabel]="
          pending.source === undefined
            ? 'Do you trust this folder?'
            : 'Do you trust this repository?'
        "
        (dismiss)="pending.source === undefined ? declined.emit() : cancelled.emit()"
      >
        <ng-template appModalContent>
          <div class="trust">
            @if (pending.source === undefined) {
              <h2 class="trust__title">Do you trust this folder?</h2>

              <p class="trust__body">
                A folder can hold code that runs on this computer as soon as an editor works with
                it: build scripts, project files, the tools its language uses. Trust it only if you
                know where it came from.
              </p>
              <p class="trust__body">
                Until you trust it, Studio shows its files and runs nothing from it. You can trust
                it later from the status bar.
              </p>
            } @else {
              <h2 class="trust__title">Do you trust this repository?</h2>

              <p class="trust__body">
                Nothing has been downloaded yet. A repository can hold code that runs on this
                computer as soon as an editor works with it: build scripts, project files, the tools
                its language uses. Trust it only if you know who it came from.
              </p>
              <p class="trust__body">
                Whatever you choose, cloning only copies its files. Until you trust it, Studio runs
                nothing from it.
              </p>
            }

            <dl class="trust__facts">
              @if (pending.source !== undefined) {
                <dt>From</dt>
                <dd class="trust__path" data-testid="trust-source">{{ pending.source }}</dd>
              }
              <dt>Folder</dt>
              <dd>{{ pending.name }}</dd>
              <dt>Location</dt>
              <dd class="trust__path">{{ pending.folder }}</dd>
            </dl>

            @if (pending.scannable) {
              <p class="trust__body trust__note">
                Scan with AI has an agent read the folder for code that would run when it opens, and
                report what it finds. It can only read; it runs nothing. The folder stays untrusted
                until you decide.
              </p>
            }

            <div class="trust__actions">
              @if (pending.scannable) {
                <app-button
                  class="trust__scan"
                  variant="ghost"
                  label="Scan with AI"
                  data-testid="trust-scan"
                  (click)="scanned.emit()"
                />
              } @else if (pending.source !== undefined) {
                <app-button
                  class="trust__scan"
                  variant="ghost"
                  label="Decide Later"
                  data-testid="trust-later"
                  (click)="deferred.emit()"
                />
              }
              <app-button-row>
                <app-button variant="solid" label="Trust" (click)="accepted.emit()" />
                <app-button
                  variant="none"
                  tone="danger"
                  label="Don't Trust"
                  (click)="declined.emit()"
                />
              </app-button-row>
            </div>
          </div>
        </ng-template>
      </app-modal>
    }
  `,
  styles: [
    `
      /* The dialog has no title bar, so it moves by any part of it that is not a control or a value
         the user may want to copy. */
      .trust {
        display: flex;
        flex-direction: column;
        gap: 0.9rem;
        -webkit-app-region: drag;
      }

      .trust__actions,
      .trust__facts dd {
        -webkit-app-region: no-drag;
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
      }

      .trust__facts dt {
        opacity: 0.7;
      }

      .trust__facts dd {
        margin: 0;
      }

      .trust__path {
        overflow-wrap: anywhere;
      }

      .trust__body {
        margin: 0;
        line-height: 1.5;
      }

      .trust__note {
        opacity: 0.8;
        font-size: 0.85rem;
      }

      .trust__actions {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        margin-block-start: 0.4rem;
      }

      .trust__scan {
        margin-inline-end: auto;
      }
    `,
  ],
})
export class RepositoryTrustModal {
  /**
   * Gets the folder being asked about, or null when nothing is being asked.
   */
  public readonly question: InputSignal<TrustQuestion | null> =
    input.required<TrustQuestion | null>();

  /**
   * Emitted when the user trusts the folder.
   */
  public readonly accepted: OutputEmitterRef<void> = output<void>();

  /**
   * Emitted when the user does not trust the folder, or dismisses the window. Nothing runs either
   * way, so the two are deliberately the same outcome.
   */
  public readonly declined: OutputEmitterRef<void> = output<void>();

  /**
   * Emitted when the user asks for the folder to be scanned before deciding.
   */
  public readonly scanned: OutputEmitterRef<void> = output<void>();

  /**
   * Emitted when, asked before a clone, the user would rather decide once it is open.
   */
  public readonly deferred: OutputEmitterRef<void> = output<void>();

  /**
   * Emitted when, asked before a clone, the user dismisses the window: nothing is cloned.
   */
  public readonly cancelled: OutputEmitterRef<void> = output<void>();
}
