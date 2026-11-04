import {
  ChangeDetectionStrategy,
  Component,
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
import { Button } from '@shared/angular/components/forms/button/button';
import { ButtonRow } from '@shared/angular/components/forms/button-row/button-row';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { Textarea } from '@shared/angular/components/forms/textarea/textarea';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';
import type { RunContainerRequest } from '@shared/api/container-types';
import { Settings } from '@shared/angular/services/settings/settings';
import type { PullMissingImages } from '@shared/angular/services/settings/settings-registry';
import { ContainersClient } from '../client/containers-client';
import { readRunForm } from './run-request';

/**
 * Runs a new container from an image (#974): the image, a name, the ports to publish, the environment
 * and the mounts, as a developer would write them on a command line. A run the engine refuses keeps the
 * form and says why.
 */
@Component({
  selector: 'app-container-run-dialog',
  imports: [Button, ButtonRow, Modal, ModalContent, SettingRow, TextField, Textarea],
  template: `
    <app-modal [open]="open()" [width]="36" ariaLabel="Run a container" (dismiss)="cancel()">
      <ng-template appModalContent>
        <h2 class="run__title">Run a container</h2>
        <app-setting-row label="Image" description="The image to run, as in postgres:16.">
          <app-text-field
            [value]="image()"
            ariaLabel="Image"
            placeholder="postgres:16"
            (valueChange)="image.set($event)"
          />
        </app-setting-row>
        <app-setting-row label="Name" description="Leave empty to let the engine choose one.">
          <app-text-field
            [value]="name()"
            ariaLabel="Container name"
            placeholder="my-database"
            (valueChange)="name.set($event)"
          />
        </app-setting-row>
        <app-setting-row
          label="Ports"
          description="host:container, separated by commas; add /udp for UDP."
        >
          <app-text-field
            [value]="ports()"
            ariaLabel="Ports"
            placeholder="5432:5432"
            (valueChange)="ports.set($event)"
          />
        </app-setting-row>
        <div class="run__block">
          <span class="run__label">Environment</span>
          <span class="run__hint">One KEY=value per line.</span>
          <app-textarea
            [value]="env()"
            [rows]="3"
            ariaLabel="Environment variables"
            placeholder="POSTGRES_PASSWORD=secret"
            (valueChange)="env.set($event)"
          />
        </div>
        <div class="run__block">
          <span class="run__label">Volumes</span>
          <span class="run__hint">
            source:/path inside — a volume name or a folder on this machine; add :ro to mount it
            read-only.
          </span>
          <app-textarea
            [value]="volumes()"
            [rows]="2"
            ariaLabel="Volumes"
            placeholder="pgdata:/var/lib/postgresql/data"
            (valueChange)="volumes.set($event)"
          />
        </div>
        @for (problem of problems(); track problem) {
          <p class="run__problem" role="alert">{{ problem }}</p>
        }
        <app-button-row>
          <app-button
            variant="solid"
            [label]="pendingPull() === null ? 'Run' : 'Pull and Run'"
            [loading]="running()"
            [disabled]="running()"
            (click)="pendingPull() === null ? run() : pullThenRun()"
          />
          <app-button label="Cancel" [disabled]="running()" (click)="cancel()" />
        </app-button-row>
      </ng-template>
    </app-modal>
  `,
  styles: `
    .run__title {
      margin: 0 0 0.6rem;
      font-size: 1.05rem;
      font-weight: 600;
    }

    .run__block {
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
      padding-block: 0.5rem;
    }

    .run__label {
      font-size: 0.85rem;
      font-weight: 500;
    }

    .run__hint {
      font-size: 0.75rem;
      color: var(--settings-muted-foreground-color);
    }

    .run__problem {
      margin: 0.25rem 0;
      font-size: 0.8rem;
      color: var(--danger-color);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContainerRunDialog {
  /**
   * Gets whether the dialog is open.
   */
  public readonly open: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets the image the dialog opens with, when it was opened from one.
   */
  public readonly initialImage: InputSignal<string> = input<string>('');

  /**
   * Raised when the dialog closes, with the new container's id when one was run.
   */
  public readonly closed: OutputEmitterRef<string | null> = output<string | null>();

  /**
   * Holds the fields.
   */
  protected readonly image: WritableSignal<string> = signal<string>('');
  protected readonly name: WritableSignal<string> = signal<string>('');
  protected readonly ports: WritableSignal<string> = signal<string>('');
  protected readonly env: WritableSignal<string> = signal<string>('');
  protected readonly volumes: WritableSignal<string> = signal<string>('');

  /**
   * Holds what is wrong with the form, or what the engine said when it refused.
   */
  protected readonly problems: WritableSignal<readonly string[]> = signal<readonly string[]>([]);

  /**
   * Holds whether a run is in flight.
   */
  protected readonly running: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the run waiting for the user to say the missing image may be pulled, or null.
   */
  protected readonly pendingPull: WritableSignal<RunContainerRequest | null> =
    signal<RunContainerRequest | null>(null);

  /**
   * Holds the engine client.
   */
  private readonly client: ContainersClient = inject(ContainersClient);

  /**
   * Holds the settings, which say what a run does about a missing image.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Resets the form each time the dialog opens.
   */
  public constructor() {
    effect((): void => {
      if (this.open()) {
        const image: string = this.initialImage();
        untracked((): void => {
          this.image.set(image);
          this.name.set('');
          this.ports.set('');
          this.env.set('');
          this.volumes.set('');
          this.problems.set([]);
        });
      }
    });
  }

  /**
   * Runs the container the form describes.
   * @returns Resolves once the engine has answered.
   */
  protected async run(): Promise<void> {
    const read: ReturnType<typeof readRunForm> = readRunForm({
      image: this.image(),
      name: this.name(),
      ports: this.ports(),
      env: this.env(),
      volumes: this.volumes(),
    });
    if ('problems' in read) {
      this.problems.set(read.problems);
      return;
    }
    this.problems.set([]);
    this.running.set(true);
    try {
      const outcome: { id?: string; error?: string; missingImage?: boolean } =
        await this.client.run(read.request);
      const pulling: PullMissingImages = this.settings.get('containers.pullMissing');
      if (outcome.missingImage === true && pulling === 'automatic') {
        await this.pullAndRun(read.request);
        return;
      }
      if (outcome.missingImage === true && pulling === 'ask') {
        this.pendingPull.set(read.request);
      }
      if (outcome.error !== undefined) {
        this.problems.set([outcome.error]);
        return;
      }
      this.closed.emit(outcome.id ?? null);
    } finally {
      this.running.set(false);
    }
  }

  /**
   * Pulls the missing image the user has said may be pulled, and runs the container.
   */
  protected async pullThenRun(): Promise<void> {
    const request: RunContainerRequest | null = this.pendingPull();
    if (request === null) {
      return;
    }
    this.pendingPull.set(null);
    this.running.set(true);
    try {
      await this.pullAndRun(request);
    } finally {
      this.running.set(false);
    }
  }

  /**
   * Pulls a run's image, then runs it; a failure at either step is shown in the dialog.
   * @param request The run.
   */
  private async pullAndRun(request: RunContainerRequest): Promise<void> {
    const pulled: { ok: boolean; error?: string } = await this.client.pullImage(request.image);
    if (!pulled.ok) {
      this.problems.set([pulled.error ?? `The image "${request.image}" could not be pulled.`]);
      return;
    }
    const outcome: { id?: string; error?: string } = await this.client.run(request);
    if (outcome.error !== undefined) {
      this.problems.set([outcome.error]);
      return;
    }
    this.problems.set([]);
    this.closed.emit(outcome.id ?? null);
  }

  /**
   * Closes the dialog without running anything.
   */
  protected cancel(): void {
    if (!this.running()) {
      this.closed.emit(null);
    }
  }
}
