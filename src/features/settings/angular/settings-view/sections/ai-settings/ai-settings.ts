import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import type { AiModelInfo, AiProviderInfo } from '@shared/api/ai/ai-provider-types';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { AgentEngine } from '@shared/angular/services/agent-engine/agent-engine';
import { Log } from '@shared/angular/services/log/log';
import { ShellPicker } from '@shared/angular/components/forms/shell-picker/shell-picker';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { Settings } from '@shared/angular/services/settings/settings';
import { SettingControl } from '../../setting-control/setting-control';
import { AiProviderConfigurations } from './ai-provider-configurations/ai-provider-configurations';
import { AiRemoteNotifications } from './ai-remote-notifications/ai-remote-notifications';
import { AiToolPolicies } from './ai-tool-policies/ai-tool-policies';
import { AiNetworkLocations } from './ai-network-locations/ai-network-locations';
import { AiWritePaths } from './ai-write-paths/ai-write-paths';

/**
 * Selects which slice of the AI settings a section instance renders, so the navigation can present
 * General, Security & Permissions, and a per-company provider page as distinct sub-sections.
 */
export type AiSettingsView = 'general' | 'security' | 'provider';

/**
 * Represents the AI section of the settings view. The {@link view} input selects the slice a given
 * instance renders: General and Security & Permissions carry global agent settings, while `provider`
 * renders one company's page (selected by {@link providerId}) — the {@link AiProviderConfigurations}
 * list the setup wizard's provider step shows too, so the two cannot drift apart.
 */
@Component({
  selector: 'app-ai-settings',
  imports: [
    Dropdown,
    ShellPicker,
    SettingRow,
    SettingControl,
    AiProviderConfigurations,
    AiRemoteNotifications,
    AiToolPolicies,
    AiNetworkLocations,
    AiWritePaths,
  ],
  templateUrl: './ai-settings.html',
  styleUrls: ['../section.scss', './ai-settings.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiSettingsSection {
  /**
   * Gets which slice of the AI settings to render. Defaults to General.
   */
  public readonly view: InputSignal<AiSettingsView> = input<AiSettingsView>('general');

  /**
   * Gets the id of the company page to render when {@link view} is `provider` (for example `anthropic`).
   */
  public readonly providerId: InputSignal<string> = input<string>('');

  /**
   * Holds the settings service the agent shell persists through.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the agent engine, whose default connection and model new conversations start with.
   */
  private readonly engine: AgentEngine = inject(AgentEngine);

  /**
   * Gets the providers a new conversation can start with — the configured connections that can run —
   * or none, when the Default Provider and Model row is hidden.
   */
  protected readonly providerOptions: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] =>
      this.engine
        .providers()
        .filter((provider: AiProviderInfo): boolean => provider.available)
        .map((provider: AiProviderInfo): DropdownOption => ({
          value: provider.id,
          label: provider.label,
        })),
  );

  /**
   * Gets the models of the default provider.
   */
  protected readonly modelOptions: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] =>
      this.engine.models().map((model: AiModelInfo): DropdownOption => ({
        value: model.id,
        label: model.label,
      })),
  );

  /**
   * Gets the default provider's id.
   */
  protected readonly defaultProvider: Signal<string> = this.engine.provider;

  /**
   * Gets the default model's id.
   */
  protected readonly defaultModel: Signal<string> = this.engine.model;

  /**
   * Sets the provider new conversations start with; its model resets to the one last chosen for it.
   * @param id The connection id.
   */
  protected onDefaultProviderChange(id: string): void {
    this.engine.setProvider(id);
  }

  /**
   * Sets the model new conversations start with.
   * @param id The model id.
   */
  protected onDefaultModelChange(id: string): void {
    this.engine.setModel(id);
  }

  /**
   * Gets the persisted agent shell (the empty string for the default login shell).
   */
  protected readonly agentShell: Signal<string> = this.settings.aiAgentShell;

  /**
   * Persists the chosen agent shell.
   * @param value The chosen shell path, or the empty string for the default login shell.
   */
  protected onAgentShellChange(value: string): void {
    this.log.info(
      'settings.ai',
      'Agent shell changed',
      value === '' ? 'default login shell' : value,
    );
    this.settings.set('ai.agentShell', value);
  }
}
