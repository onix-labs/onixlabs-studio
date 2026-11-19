import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  Signal,
  signal,
  untracked,
  WritableSignal,
} from '@angular/core';
import type { AiConnection } from '@shared/api/ai-types';
import { isLocalConnection } from '@shared/api/is-local-connection';
import type { PersonaRebuildEstimate, PersonaRebuildMode } from '@shared/api/pete-protocol';
import { Button } from '@shared/angular/components/forms/button/button';
import {
  ButtonGroup,
  ButtonGroupOption,
} from '@shared/angular/components/forms/button-group/button-group';
import { ButtonRow } from '@shared/angular/components/forms/button-row/button-row';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';
import { Log } from '@shared/angular/services/log/log';
import { Pete } from '@shared/angular/services/persona/pete';
import { Settings } from '@shared/angular/services/settings/settings';

/**
 * Starting a full rebuild of the persona from every conversation (#1518): the model for the job, merge
 * or start fresh, and — before anything is sent anywhere — how many conversations there are, how much
 * the user typed in them, and roughly how many tokens that is. The results go through the user's
 * review setting, like anything else Pete learns.
 */
@Component({
  selector: 'app-persona-rebuild',
  imports: [Button, ButtonGroup, ButtonRow, Dropdown, Modal, ModalContent, SettingRow, TextField],
  templateUrl: './persona-rebuild.html',
  styleUrl: './persona-rebuild.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PersonaRebuild {
  /**
   * Gets whether the dialog is open.
   */
  public readonly open: InputSignal<boolean> = input<boolean>(false);

  /**
   * Emits when the dialog closes, started or not.
   */
  public readonly closed: OutputEmitterRef<void> = output<void>();

  /**
   * Gets the choices of mode.
   */
  protected readonly modes: readonly ButtonGroupOption[] = [
    { value: 'merge', label: 'Merge into my persona' },
    { value: 'fresh', label: 'Start fresh' },
  ];

  /**
   * Holds Pete.
   */
  private readonly pete: Pete = inject(Pete);

  /**
   * Holds the settings.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the connection chosen for the job.
   */
  protected readonly connectionId: WritableSignal<string> = signal<string>('');

  /**
   * Holds the model chosen for the job.
   */
  protected readonly model: WritableSignal<string> = signal<string>('');

  /**
   * Holds the mode chosen.
   */
  protected readonly mode: WritableSignal<PersonaRebuildMode> = signal<PersonaRebuildMode>('merge');

  /**
   * Holds the estimate, or null while it is counted.
   */
  protected readonly estimate: WritableSignal<PersonaRebuildEstimate | null> =
    signal<PersonaRebuildEstimate | null>(null);

  /**
   * Holds why the rebuild did not start, or null.
   */
  protected readonly error: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Gets the connections to choose from, local ones marked.
   */
  protected readonly connections: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] =>
      this.settings.aiConnections().map((connection: AiConnection): DropdownOption => ({
        value: connection.id,
        label: isLocalConnection(connection)
          ? `${connection.label} (on this machine)`
          : connection.label,
      })),
  );

  /**
   * Gets whether the connection chosen runs on this machine.
   */
  protected readonly local: Signal<boolean> = computed((): boolean => {
    const id: string = this.connectionId();
    const connection: AiConnection | undefined = this.settings
      .aiConnections()
      .find((candidate: AiConnection): boolean => candidate.id === id);
    return connection !== undefined && isLocalConnection(connection);
  });

  /**
   * Gets the estimate in words.
   */
  protected readonly estimateText: Signal<string> = computed((): string => {
    const estimate: PersonaRebuildEstimate | null = this.estimate();
    if (estimate === null) {
      return 'Counting your conversations…';
    }
    if (estimate.conversations === 0) {
      return 'There is nothing you typed in your conversations for Pete to read.';
    }
    return (
      `${estimate.conversations} conversation${estimate.conversations === 1 ? '' : 's'}, ` +
      `about ${formatCount(estimate.characters)} characters you typed. Pete reads them in ` +
      `${estimate.batches} batch${estimate.batches === 1 ? '' : 'es'}, sending the model about ` +
      `${formatCount(estimate.tokens)} tokens.`
    );
  });

  /**
   * Gets what happens to the tokens, in words.
   */
  protected readonly costText: Signal<string> = computed((): string =>
    this.local()
      ? 'This model runs on this machine: nothing is sent anywhere, and it costs nothing.'
      : 'Only what you typed is sent, never tool output or files. A paid model charges for these tokens at its usual rate.',
  );

  /**
   * Gets what the user's review setting means for the results.
   */
  protected readonly reviewText: Signal<string> = computed((): string =>
    this.settings.value('persona.review')() === 'ask'
      ? "What Pete learns waits for your review, as you've set."
      : "What Pete learns is applied as he goes, as you've set, and can be undone.",
  );

  /**
   * Prepares the dialog each time it opens: the connection and model Pete uses, and a fresh count.
   */
  public constructor() {
    effect((): void => {
      if (!this.open()) {
        return;
      }
      untracked((): void => {
        const pete: string = this.settings.get('persona.peteConnectionId');
        this.connectionId.set(pete.length > 0 ? pete : this.settings.aiActiveConnectionId());
        this.model.set(this.settings.get('persona.peteModel'));
        this.mode.set('merge');
        this.error.set(null);
        this.estimate.set(null);
        void this.count();
      });
    });
  }

  /**
   * Sets the mode.
   * @param mode The mode picked.
   */
  protected setMode(mode: string): void {
    this.mode.set(mode === 'fresh' ? 'fresh' : 'merge');
  }

  /**
   * Starts the rebuild and closes.
   * @returns Resolves once started, or refused.
   */
  protected async start(): Promise<void> {
    const error: string | null = await this.pete.startRebuild({
      mode: this.mode(),
      connectionId: this.connectionId(),
      model: this.model().trim(),
    });
    if (error !== null) {
      this.error.set(error);
      return;
    }
    this.log.info('aiManager.persona', `Persona rebuild started (${this.mode()})`);
    this.closed.emit();
  }

  /**
   * Closes without starting.
   */
  protected cancel(): void {
    this.closed.emit();
  }

  /**
   * Counts what the rebuild would read.
   * @returns Resolves once counted.
   */
  private async count(): Promise<void> {
    this.estimate.set(await this.pete.estimateRebuild());
  }
}

/**
 * Formats a count the way people read it: 1,234 or 12k.
 * @param value The count.
 * @returns Returns the text.
 */
function formatCount(value: number): string {
  return value >= 10_000 ? `${Math.round(value / 1_000)}k` : value.toLocaleString('en-GB');
}
