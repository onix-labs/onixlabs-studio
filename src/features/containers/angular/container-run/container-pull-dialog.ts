import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  signal,
  untracked,
  WritableSignal,
} from '@angular/core';
import type { ImagePullProgress } from '@shared/api/container-types';
import { Button } from '@shared/angular/components/forms/button/button';
import { ButtonRow } from '@shared/angular/components/forms/button-row/button-row';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';
import { ProgressBar } from '@shared/angular/components/progress-bar/progress-bar';
import { ContainersClient } from '../client/containers-client';

/**
 * Downloads an image by reference (#974), showing how far it has got. The dialog can be closed while
 * the download runs; the engine finishes it regardless, and the Images list picks it up.
 */
@Component({
  selector: 'app-container-pull-dialog',
  imports: [Button, ButtonRow, Modal, ModalContent, ProgressBar, SettingRow, TextField],
  template: `
    <app-modal [open]="open()" [width]="30" ariaLabel="Pull an image" (dismiss)="close()">
      <ng-template appModalContent>
        <h2 class="pull__title">Pull an image</h2>
        <app-setting-row label="Image" description="As in postgres:16, or ghcr.io/owner/name:tag.">
          <app-text-field
            [value]="reference()"
            ariaLabel="Image to pull"
            placeholder="postgres:16"
            [disabled]="pulling()"
            (valueChange)="reference.set($event)"
            (enter)="pull()"
          />
        </app-setting-row>
        @if (pulling()) {
          <app-progress-bar [label]="progressText()" />
          <p class="pull__status">{{ progressText() }}</p>
        }
        @if (error(); as message) {
          <p class="pull__error" role="alert">{{ message }}</p>
        }
        <app-button-row>
          <app-button
            variant="solid"
            label="Pull"
            [loading]="pulling()"
            [disabled]="pulling() || reference().trim().length === 0"
            (click)="pull()"
          />
          <app-button [label]="pulling() ? 'Close' : 'Cancel'" (click)="close()" />
        </app-button-row>
      </ng-template>
    </app-modal>
  `,
  styles: `
    .pull__title {
      margin: 0 0 0.6rem;
      font-size: 1.05rem;
      font-weight: 600;
    }

    .pull__status {
      margin: 0.4rem 0 0;
      font-size: 0.78rem;
      color: var(--settings-muted-foreground-color);
    }

    .pull__error {
      margin: 0.4rem 0 0;
      font-size: 0.8rem;
      color: var(--danger-color);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContainerPullDialog {
  /**
   * Gets whether the dialog is open.
   */
  public readonly open: InputSignal<boolean> = input<boolean>(false);

  /**
   * Raised when the dialog closes, with whether an image was pulled.
   */
  public readonly closed: OutputEmitterRef<boolean> = output<boolean>();

  /**
   * Holds the image reference.
   */
  protected readonly reference: WritableSignal<string> = signal<string>('');

  /**
   * Holds whether a download is running.
   */
  protected readonly pulling: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the words describing its progress.
   */
  protected readonly progressText: WritableSignal<string> = signal<string>('');

  /**
   * Holds why the last download failed.
   */
  protected readonly error: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds the engine client.
   */
  private readonly client: ContainersClient = inject(ContainersClient);

  /**
   * Follows the download's progress, and clears the form when the dialog opens.
   */
  public constructor() {
    const unsubscribe: () => void = this.client.onPullProgress(
      (progress: ImagePullProgress): void => {
        if (progress.reference === this.reference().trim()) {
          this.progressText.set(describe(progress));
        }
      },
    );
    inject(DestroyRef).onDestroy(unsubscribe);
    effect((): void => {
      if (this.open()) {
        untracked((): void => {
          if (!this.pulling()) {
            this.reference.set('');
            this.error.set(null);
          }
        });
      }
    });
  }

  /**
   * Downloads the image.
   * @returns Resolves once the download has finished.
   */
  protected async pull(): Promise<void> {
    const reference: string = this.reference().trim();
    if (reference.length === 0 || this.pulling()) {
      return;
    }
    this.error.set(null);
    this.progressText.set('Starting…');
    this.pulling.set(true);
    try {
      const outcome: { ok: boolean; error?: string } = await this.client.pullImage(reference);
      if (!outcome.ok) {
        this.error.set(outcome.error ?? 'The image could not be downloaded.');
        return;
      }
      this.closed.emit(true);
    } finally {
      this.pulling.set(false);
    }
  }

  /**
   * Closes the dialog; a download in flight carries on.
   */
  protected close(): void {
    this.closed.emit(false);
  }
}

/**
 * Describes a download's progress in words.
 * @param progress The progress.
 * @returns Returns the description.
 */
export function describe(progress: ImagePullProgress): string {
  if (progress.current === undefined || progress.total === undefined || progress.total === 0) {
    return progress.status;
  }
  const mb: (bytes: number) => string = (bytes: number): string =>
    `${(bytes / 1024 / 1024).toFixed(0)} MB`;
  return `${progress.status} — ${mb(progress.current)} of ${mb(progress.total)}`;
}
