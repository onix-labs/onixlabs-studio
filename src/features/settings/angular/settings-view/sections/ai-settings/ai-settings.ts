import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
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
