import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  Signal,
} from '@angular/core';
import type { AiRemoteControlPosture } from '@shared/api/ai-types';
import { Settings } from '@shared/angular/services/settings/settings';
import { Button } from '@shared/angular/components/forms/button/button';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';

/**
 * The confirmation raised by every Remote Control toggle — an agent's own (its tool strip and ribbon)
 * and Mission Control's enable-for-every-agent one.
 *
 * Exposing a session hands another machine a view of, or a hand on, a running agent, so the toggle
 * asks before it flips rather than after. The dialog names what exposure will mean, which is the user's
 * global Remote control posture rather than anything the toggle chooses: the toggle is on or off, and
 * Settings decides whether on means Full Control or Read-Only.
 */
@Component({
  selector: 'app-agent-remote-modal',
  imports: [Modal, ModalContent, Button],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal [open]="open()" [width]="30" [ariaLabel]="title()" (dismiss)="dismissed.emit()">
      <ng-template appModalContent>
        <div class="remote-modal">
          <h2 class="remote-modal__title">{{ title() }}</h2>
          <p class="remote-modal__body">{{ body() }}</p>
          <p class="remote-modal__hint">{{ hint() }}</p>
          <div class="remote-modal__actions">
            <app-button variant="solid" label="Yes" (click)="confirmed.emit()" />
            <app-button label="No" (click)="dismissed.emit()" />
          </div>
        </div>
      </ng-template>
    </app-modal>
  `,
  styles: [
    `
      .remote-modal {
        display: flex;
        flex-direction: column;
        gap: 0.9rem;
      }

      .remote-modal__title {
        margin: 0;
        font-size: 1.05rem;
      }

      .remote-modal__body {
        margin: 0;
        line-height: 1.5;
      }

      .remote-modal__hint {
        margin: 0;
        font-size: 0.85rem;
        color: var(--muted-foreground-color, var(--body-foreground-color));
      }

      .remote-modal__actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.6rem;
        margin-block-start: 0.4rem;
      }

      // Yes and No are two words of very different length, and a pair of buttons sized to their
      // labels reads as a mistake. A floor on the host — the layout box the button fills — gives them
      // a matching footprint without reaching into the button's own measurements.
      .remote-modal__actions app-button {
        min-inline-size: 6rem;
      }
    `,
  ],
})
export class AgentRemoteModal {
  /**
   * Holds the settings the Remote control posture is read from, so the dialog says what turning the
   * toggle on will actually permit.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Gets a value indicating whether the dialog is shown. The host binds this to its pending toggle.
   */
  public readonly open: InputSignal<boolean> = input.required<boolean>();

  /**
   * Gets a value indicating whether the pending toggle turns remote control on (rather than off),
   * which is what the dialog asks about.
   */
  public readonly enabling: InputSignal<boolean> = input.required<boolean>();

  /**
   * Gets how many agents the pending toggle acts on. One (the default) is a single agent's own toggle;
   * more is a bulk toggle such as Mission Control's, which says so.
   */
  public readonly count: InputSignal<number> = input<number>(1);

  /**
   * Emits when the user answers Yes. The host performs the toggle and closes the dialog.
   */
  public readonly confirmed: OutputEmitterRef<void> = output<void>();

  /**
   * Emits when the user answers No, or dismisses the dialog. The host closes it, leaving the toggle
   * where it was.
   */
  public readonly dismissed: OutputEmitterRef<void> = output<void>();

  /**
   * Gets the configured Remote control posture.
   */
  private readonly posture: Signal<AiRemoteControlPosture> = this.settings.aiRemoteControlPosture;

  /**
   * Gets the posture's display name, matching the Settings dropdown the user set it from.
   */
  private readonly postureLabel: Signal<string> = computed((): string =>
    this.posture() === 'control' ? 'Full Control' : 'Read-Only',
  );

  /**
   * Gets the dialog's question, which doubles as its accessible name.
   */
  protected readonly title: Signal<string> = computed((): string => {
    const subject: string = this.count() === 1 ? 'this agent' : `all ${this.count()} agents`;
    return this.enabling()
      ? `Enable remote control for ${subject}?`
      : `Disable remote control for ${subject}?`;
  });

  /**
   * Gets the sentence describing what answering Yes does.
   */
  protected readonly body: Signal<string> = computed((): string => {
    const subject: string = this.count() === 1 ? 'This agent’s session' : 'Every agent’s session';
    if (!this.enabling()) {
      return `${subject} will stop being exposed, and any remote peer will lose access to it.`;
    }
    const verb: string =
      this.posture() === 'control'
        ? 'where a peer can drive it as if they were sitting here'
        : 'where a peer can watch it, but not act on it';
    return `${subject} will be exposed to your provider’s remote surface, ${verb}.`;
  });

  /**
   * Gets the qualifying line beneath the body: which posture is in force, and when the change lands.
   */
  protected readonly hint: Signal<string> = computed((): string => {
    const when: string = 'Takes effect on the next message sent.';
    return this.enabling()
      ? `Remote control posture is set to ${this.postureLabel()}, in Settings › Artificial Intelligence. ${when}`
      : when;
  });
}
