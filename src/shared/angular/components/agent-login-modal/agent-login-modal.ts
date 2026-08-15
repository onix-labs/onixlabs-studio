import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  signal,
  Signal,
  untracked,
  WritableSignal,
} from '@angular/core';
import type { ClaudeLoginStatus } from '@shared/api/ai-types';
import { AiRuntime } from '@shared/angular/services/ai-runtime/ai-runtime';
import { Shell } from '@shared/angular/services/shell/shell';
import { Log } from '@shared/angular/services/log/log';
import { Button } from '@shared/angular/components/forms/button/button';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';

/**
 * A phase of the in-app Claude sign-in as the modal tracks it: `idle` before the user starts, then the
 * driver's own phases (`starting`, `browser`, `success`, `error`).
 */
type LoginPhase = 'idle' | 'starting' | 'browser' | 'success' | 'error';

/**
 * The "you're not signed in to Claude" dialog. Shown when an agent run through the Claude local-login
 * connection fails because the login has expired or is absent (raised by {@link Agent.needsLogin}); its
 * primary action drives the CLI's own OAuth flow — which opens the user's browser — entirely from here,
 * so signing back in never means dropping to a terminal. Progress streams in from the main-process login
 * driver; on success the modal closes and the failed turn's error card keeps its Retry.
 */
@Component({
  selector: 'app-agent-login-modal',
  imports: [Modal, ModalContent, Button],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal
      [open]="open()"
      [width]="30"
      ariaLabel="Sign in to Claude"
      (dismiss)="close()"
    >
      <ng-template appModalContent>
        <div class="login-modal">
          <h2 class="login-modal__title">You're not signed in to Claude</h2>
          <p class="login-modal__body">
            @switch (phase()) {
              @case ('starting') {
                Starting sign-in…
              }
              @case ('browser') {
                Complete the sign-in in your browser, then come back here.
              }
              @case ('success') {
                You're signed in. You can retry your message now.
              }
              @case ('error') {
                Sign-in didn't complete. {{ errorMessage() }}
              }
              @default {
                Your Claude session has expired or you're signed out. Sign in to carry on using the
                agent.
              }
            }
          </p>

          @if (phase() === 'browser' && url(); as link) {
            <p class="login-modal__hint">
              Browser didn't open?
              <a class="login-modal__link" href="#" (click)="openUrl(link, $event)">
                Open the sign-in page
              </a>
            </p>
          }

          <div class="login-modal__actions">
            <app-button label="Dismiss" (click)="close()" />
            @if (phase() === 'success') {
              <app-button variant="solid" label="Done" (click)="close()" />
            } @else {
              <app-button
                variant="solid"
                [loading]="busy()"
                [label]="phase() === 'error' ? 'Try again' : 'Log in to Claude'"
                (click)="startLogin()"
              />
            }
          </div>
        </div>
      </ng-template>
    </app-modal>
  `,
  styles: [
    `
      .login-modal {
        display: flex;
        flex-direction: column;
        gap: 0.9rem;
      }

      .login-modal__title {
        margin: 0;
        font-size: 1.05rem;
      }

      .login-modal__body {
        margin: 0;
        line-height: 1.5;
      }

      .login-modal__hint {
        margin: 0;
        font-size: 0.85rem;
        color: var(--muted-foreground-color, var(--body-foreground-color));
      }

      .login-modal__link {
        color: var(--accent-color);
      }

      .login-modal__actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.6rem;
        margin-block-start: 0.4rem;
      }
    `,
  ],
})
export class AgentLoginModal {
  /**
   * Holds the agent runtime the login flow is driven through.
   */
  private readonly runtime: AiRuntime = inject(AiRuntime);

  /**
   * Holds the shell service used to open the sign-in page in the default browser.
   */
  private readonly shell: Shell = inject(Shell);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets a value indicating whether the modal is shown. The host binds this to the conversation's
   * pending sign-in prompt.
   */
  public readonly open: InputSignal<boolean> = input.required<boolean>();

  /**
   * Emitted when the modal is dismissed without signing in — the user closed it. The host clears its
   * prompt in response.
   */
  public readonly dismiss: OutputEmitterRef<void> = output<void>();

  /**
   * Emitted once sign-in has completed. The host reopens the conversation's session (so the next turn
   * re-authenticates) and closes the modal.
   */
  public readonly succeeded: OutputEmitterRef<void> = output<void>();

  /**
   * Holds the current sign-in phase.
   */
  protected readonly phase: WritableSignal<LoginPhase> = signal<LoginPhase>('idle');

  /**
   * Holds the sign-in URL for the manual "open the sign-in page" fallback, or undefined when none was
   * surfaced.
   */
  protected readonly url: WritableSignal<string | undefined> = signal<string | undefined>(undefined);

  /**
   * Holds the short reason shown in the error phase.
   */
  protected readonly errorMessage: WritableSignal<string> = signal<string>('');

  /**
   * Gets whether the login is in flight, so the primary action shows a spinner and cannot be pressed
   * again while the browser step is outstanding.
   */
  protected readonly busy: Signal<boolean> = computed(
    (): boolean => this.phase() === 'starting' || this.phase() === 'browser',
  );

  /**
   * Initializes a new instance of the {@link AgentLoginModal} class, subscribing to the login flow's
   * progress and resetting whenever the modal is closed.
   */
  public constructor() {
    const destroyRef: DestroyRef = inject(DestroyRef);
    const unsubscribe: () => void = this.runtime.onClaudeLoginStatus(
      (status: ClaudeLoginStatus): void => this.onStatus(status),
    );
    destroyRef.onDestroy(unsubscribe);
    effect((): void => {
      if (!this.open()) {
        untracked((): void => this.reset());
      }
    });
  }

  /**
   * Starts (or retries) the in-app Claude sign-in.
   */
  protected startLogin(): void {
    this.log.info('agent.login', 'Starting in-app Claude sign-in');
    this.errorMessage.set('');
    this.url.set(undefined);
    this.phase.set('starting');
    this.runtime.startClaudeLogin();
  }

  /**
   * Opens the sign-in page in the default browser (the manual fallback), suppressing the anchor's default
   * navigation.
   * @param link The sign-in URL.
   * @param event The click event to suppress.
   */
  protected openUrl(link: string, event: Event): void {
    event.preventDefault();
    void this.shell.openExternal(link);
  }

  /**
   * Closes the modal, cancelling an in-flight login first so no orphaned sign-in process is left running.
   */
  protected close(): void {
    if (this.busy()) {
      this.runtime.cancelClaudeLogin();
    }
    this.dismiss.emit();
  }

  /**
   * Folds a streamed login-progress update into the modal's state. Ignored while the modal is closed, so
   * only the dialog that started a sign-in reacts to its progress.
   * @param status The progress update.
   */
  private onStatus(status: ClaudeLoginStatus): void {
    if (!this.open()) {
      return;
    }
    this.phase.set(status.phase);
    if (status.phase === 'browser') {
      this.url.set(status.url);
    } else if (status.phase === 'error') {
      this.errorMessage.set(status.message ?? '');
    } else if (status.phase === 'success') {
      this.log.info('agent.login', 'In-app Claude sign-in succeeded');
      this.succeeded.emit();
    }
  }

  /**
   * Resets the modal to its idle state, cancelling an in-flight login. Runs when the modal closes so the
   * next open starts fresh.
   */
  private reset(): void {
    if (this.busy()) {
      this.runtime.cancelClaudeLogin();
    }
    this.phase.set('idle');
    this.url.set(undefined);
    this.errorMessage.set('');
  }
}
