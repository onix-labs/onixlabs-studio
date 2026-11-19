import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import type { AiConnection } from '@shared/api/ai-types';
import { Dropdown, type DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { Settings } from '@shared/angular/services/settings/settings';

/**
 * Represents the rows on AI Manager › Persona that choose Pete's AI connection and model (#1516).
 * Which provider reads the conversations is the user's to see plainly, so the row says where they go;
 * a local model keeps them on this machine, and is suggested.
 */
@Component({
  selector: 'app-pete-connection',
  imports: [Dropdown, SettingRow, TextField],
  template: `
    <app-setting-row label="Pete's Connection" [description]="destination()">
      <app-dropdown
        [options]="options()"
        [value]="connectionId()"
        ariaLabel="Pete's connection"
        data-testid="pete-connection"
        (valueChange)="choose($event)"
      />
    </app-setting-row>
    <app-setting-row
      label="Pete's Model"
      description="The model Pete uses, or empty for the connection's default. A small model is enough."
    >
      <app-text-field
        [value]="model()"
        ariaLabel="Pete's model"
        placeholder="Connection default"
        [disabled]="connectionId() === ''"
        (valueChange)="setModel($event)"
      />
    </app-setting-row>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PeteConnection {
  /**
   * Holds the settings.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Gets the chosen connection's id, or empty when Pete is off.
   */
  protected readonly connectionId: Signal<string> = this.settings.value('persona.peteConnectionId');

  /**
   * Gets the chosen model.
   */
  protected readonly model: Signal<string> = this.settings.value('persona.peteModel');

  /**
   * Gets the choices: off, then every connection, local ones marked.
   */
  protected readonly options: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] => [
      { value: '', label: 'Off — Pete learns nothing' },
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
      return 'Pete is off until you choose a connection. A local model keeps your conversations on this machine.';
    }
    return isLocal(connection)
      ? `What you type is read on this machine, by ${connection.label}.`
      : `What you type in conversations is sent to ${connection.label} for Pete to read. A local model would keep it on this machine.`;
  });

  /**
   * Chooses Pete's connection.
   * @param id The connection's id, or empty for off.
   */
  protected choose(id: string): void {
    this.settings.set('persona.peteConnectionId', id);
  }

  /**
   * Sets Pete's model.
   * @param model The model.
   */
  protected setModel(model: string): void {
    this.settings.set('persona.peteModel', model.trim());
  }
}

/**
 * Determines whether a connection runs on this machine.
 * @param connection The connection.
 * @returns Returns true for a local model server.
 */
function isLocal(connection: AiConnection): boolean {
  if (connection.kind === 'ollama') {
    return true;
  }
  const url: string = connection.baseUrl ?? '';
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(url);
}
