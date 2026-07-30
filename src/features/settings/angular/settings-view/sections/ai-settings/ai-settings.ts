import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import type { AiAuthStatus, AiConnection, AiProviderKind } from '@shared/api/ai-types';
import { ShellInfo } from '@shared/api/terminal-channels';
import { AiConnections } from '@shared/angular/services/ai-connections/ai-connections';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { Settings } from '@shared/angular/services/settings/settings';
import { TerminalShells } from '@shared/angular/services/terminal-shells/terminal-shells';
import { SettingControl } from '../../setting-control/setting-control';
import { AiConnectionEditor } from './ai-connection-editor/ai-connection-editor';
import { AiToolPolicies } from './ai-tool-policies/ai-tool-policies';
import { AiWritePaths } from './ai-write-paths/ai-write-paths';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Button } from '@shared/angular/components/forms/button/button';
import { Icon } from '@shared/angular/icons/icon';

/**
 * The provider-kind options offered when adding a connection.
 */
const ADD_KIND_OPTIONS: readonly DropdownOption[] = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'xai', label: 'xAI (Grok)' },
  { value: 'google', label: 'Google (Gemini)' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'ollama', label: 'Ollama (local)' },
  { value: 'openai-compatible', label: 'OpenAI-compatible' },
  { value: 'custom', label: 'Custom' },
];

/**
 * Represents the AI section of the settings view: a manager for the user's provider connections (add,
 * edit, reorder, and remove; each with its credential and model list) plus the default permission
 * posture and per-request token cap. Connection state is owned by {@link AiConnections}, which persists
 * the collection and keeps each key in the main process.
 */
@Component({
  selector: 'app-ai-settings',
  imports: [
    Button,
    Dropdown,
    SettingRow,
    SettingControl,
    AiConnectionEditor,
    AiToolPolicies,
    AiWritePaths,
    AppIcon,
  ],
  templateUrl: './ai-settings.html',
  styleUrls: ['../section.scss', './ai-settings.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiSettingsSection {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the kind options for the add-connection picker.
   */
  protected readonly addKindOptions: readonly DropdownOption[] = ADD_KIND_OPTIONS;

  /**
   * Holds the connection-management service.
   */
  private readonly connectionsService: AiConnections = inject(AiConnections);

  /**
   * Holds the settings service the agent shell persists through.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the installed-shells provider populating the agent-shell dropdown.
   */
  private readonly terminalShells: TerminalShells = inject(TerminalShells);

  /**
   * Gets the agent-shell dropdown options: a leading "Default login shell" entry (the empty value,
   * inheriting the startup-hydrated environment) followed by each installed shell.
   */
  protected readonly shellOptions: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] => [
      { value: '', label: 'Default login shell' },
      ...this.terminalShells
        .shells()
        .map((shell: ShellInfo): DropdownOption => ({ value: shell.path, label: shell.name })),
    ],
  );

  /**
   * Gets the persisted agent shell (the empty string for the default login shell).
   */
  protected readonly agentShell: Signal<string> = this.settings.aiAgentShell;

  /**
   * Holds the ids of the currently-expanded connections.
   */
  private readonly expandedIds: WritableSignal<ReadonlySet<string>> = signal<ReadonlySet<string>>(
    new Set<string>(),
  );

  /**
   * Holds the kind selected in the add-connection picker.
   */
  private readonly addKind: WritableSignal<AiProviderKind> = signal<AiProviderKind>('openai');

  /**
   * Gets the configured connections.
   */
  protected readonly connections: Signal<readonly AiConnection[]> =
    this.connectionsService.connections;

  /**
   * Gets a value indicating whether the agent bridge is available.
   */
  protected readonly isAvailable: boolean = this.connectionsService.isAvailable;

  /**
   * Gets the kind selected in the add-connection picker.
   */
  protected readonly selectedAddKind: Signal<AiProviderKind> = this.addKind.asReadonly();

  /**
   * Initialises the section, refreshing every connection's auth status.
   */
  public constructor() {
    void this.connectionsService.refreshAllAuth();
  }

  /**
   * Reports whether a connection is expanded.
   * @param id The connection id.
   * @returns Returns true when the connection is expanded.
   */
  protected isExpanded(id: string): boolean {
    return this.expandedIds().has(id);
  }

  /**
   * Toggles a connection's expanded state.
   * @param id The connection id.
   */
  protected toggle(id: string): void {
    this.expandedIds.update((current: ReadonlySet<string>): ReadonlySet<string> => {
      const next: Set<string> = new Set<string>(current);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  }

  /**
   * Gets a connection's auth status.
   * @param id The connection id.
   * @returns Returns the status.
   */
  protected status(id: string): AiAuthStatus {
    return this.connectionsService.authStatus(id);
  }

  /**
   * Records the kind selected in the add-connection picker.
   * @param kind The selected kind.
   */
  protected onAddKindChange(kind: string): void {
    this.addKind.set(kind as AiProviderKind);
  }

  /**
   * Adds a connection of the selected kind and expands it.
   */
  protected addConnection(): void {
    const connection: AiConnection = this.connectionsService.add(this.addKind());
    this.expandedIds.update(
      (current: ReadonlySet<string>): ReadonlySet<string> =>
        new Set<string>(current).add(connection.id),
    );
  }

  /**
   * Restores the default connections (resets the seeds and keeps the user's own).
   */
  protected restoreDefaults(): void {
    this.connectionsService.restoreDefaults();
  }

  /**
   * Moves a connection up one place.
   * @param id The connection id.
   */
  protected moveUp(id: string): void {
    this.connectionsService.move(id, -1);
  }

  /**
   * Moves a connection down one place.
   * @param id The connection id.
   */
  protected moveDown(id: string): void {
    this.connectionsService.move(id, 1);
  }

  /**
   * Persists the chosen agent shell.
   * @param value The chosen shell path, or the empty string for the default login shell.
   */
  protected onAgentShellChange(value: string): void {
    this.settings.set('ai.agentShell', value);
  }
}
