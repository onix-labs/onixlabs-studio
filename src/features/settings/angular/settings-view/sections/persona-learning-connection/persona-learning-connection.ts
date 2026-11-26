import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import type { AiConnection, AiProviderInfo } from '@shared/api/ai-types';
import { isLocalConnection as isLocal } from '@shared/api/is-local-connection';
import { Dropdown, type DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { AgentEngine } from '@shared/angular/services/agent-engine/agent-engine';
import { modelOptions } from '@shared/angular/services/agent-engine/engine-options';
import { Settings } from '@shared/angular/services/settings/settings';

/**
 * Represents the rows on AI Manager › Persona that choose the learning AI connection and model (#1516).
 * Which provider reads the conversations is the user's to see plainly, so the row says where they go;
 * a local model keeps them on this machine, and is suggested.
 */
@Component({
  selector: 'app-persona-learning-connection',
  imports: [Dropdown, SettingRow],
  template: `
    <app-setting-row label="Learning Connection" [description]="destination()">
      <app-dropdown
        [options]="options()"
        [value]="connectionId()"
        ariaLabel="Learning connection"
        data-testid="persona-learning-connection"
        (valueChange)="choose($event)"
      />
    </app-setting-row>
    <app-setting-row
      label="Learning Model"
      description="The model used for learning, from those the connection offers. A small model is enough."
    >
      <app-dropdown
        [options]="models()"
        [value]="model()"
        ariaLabel="Learning model"
        data-testid="persona-learning-model"
        [disabled]="connectionId() === ''"
        (valueChange)="setModel($event)"
      />
    </app-setting-row>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PersonaLearningConnection {
  /**
   * Holds the settings.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the agent engine, which knows the models each connection offers, as the agent's picker does.
   */
  private readonly engine: AgentEngine = inject(AgentEngine);

  /**
   * Gets the chosen connection's id, or empty when persona learning is off.
   */
  protected readonly connectionId: Signal<string> = this.settings.value(
    'persona.learningConnectionId',
  );

  /**
   * Gets the chosen model.
   */
  protected readonly model: Signal<string> = this.settings.value('persona.learningModel');

  /**
   * Gets the models the chosen connection offers, as the agent's picker lists them, with its default
   * first. A model chosen earlier that the connection no longer offers stays listed, so the row shows
   * what is set rather than going blank.
   */
  protected readonly models: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] => {
      const id: string = this.connectionId();
      const provider: AiProviderInfo | undefined = this.engine
        .providers()
        .find((candidate: AiProviderInfo): boolean => candidate.id === id);
      const options: readonly DropdownOption[] = modelOptions(provider);
      const chosen: string = this.model();
      return chosen.length === 0 ||
        options.some((option: DropdownOption): boolean => option.value === chosen)
        ? options
        : [...options, { value: chosen, label: `${chosen} (not offered)`, disabled: true }];
    },
  );

  /**
   * Gets the choices: off, then every connection, local ones marked.
   */
  protected readonly options: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] => [
      { value: '', label: 'Off — nothing is learned' },
      ...this.settings.aiConnections().map((connection: AiConnection): DropdownOption => ({
        value: connection.id,
        label: isLocal(connection) ? `${connection.label} (on this machine)` : connection.label,
      })),
    ],
  );

  /**
   * Gets where the conversations go with the connection chosen, in words.
   */
  protected readonly destination: Signal<string> = computed((): string => {
    const id: string = this.connectionId();
    const connection: AiConnection | undefined = this.settings
      .aiConnections()
      .find((candidate: AiConnection): boolean => candidate.id === id);
    if (connection === undefined) {
      return 'Persona learning is off until you choose a connection. A local model keeps your conversations on this machine.';
    }
    return isLocal(connection)
      ? `What you type is read on this machine, by ${connection.label}.`
      : `What you type in conversations is sent to ${connection.label} to learn from. A local model would keep it on this machine.`;
  });

  /**
   * Chooses the learning connection.
   * @param id The connection's id, or empty for off.
   */
  protected choose(id: string): void {
    this.settings.set('persona.learningConnectionId', id);
    // A model belongs to its connection, so another connection starts on its own default.
    this.settings.set('persona.learningModel', '');
  }

  /**
   * Sets the learning model.
   * @param model The model.
   */
  protected setModel(model: string): void {
    this.settings.set('persona.learningModel', model.trim());
  }
}
