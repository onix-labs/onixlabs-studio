import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import type { AiAuthStatus, AiConnection, AuthMethod, ProviderPage } from '@shared/api/ai-types';
import { PROVIDER_PAGES } from '@shared/api/ai-types';
import { ShellInfo } from '@shared/api/terminal-channels';
import { AiConnections } from '@shared/angular/services/ai-connections/ai-connections';
import { Log } from '@shared/angular/services/log/log';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { Settings } from '@shared/angular/services/settings/settings';
import { TerminalShells } from '@shared/angular/services/terminal-shells/terminal-shells';
import { SettingControl } from '../../setting-control/setting-control';
import { AiConnectionEditor } from './ai-connection-editor/ai-connection-editor';
import { AiRemoteNotifications } from './ai-remote-notifications/ai-remote-notifications';
import { AiToolPolicies } from './ai-tool-policies/ai-tool-policies';
import { AiNetworkLocations } from './ai-network-locations/ai-network-locations';
import { AiWritePaths } from './ai-write-paths/ai-write-paths';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Button } from '@shared/angular/components/forms/button/button';
import { Icon } from '@shared/angular/icons/icon';

/**
 * Selects which slice of the AI settings a section instance renders, so the navigation can present
 * General, Security & Permissions, and a per-company provider page as distinct sub-sections.
 */
export type AiSettingsView = 'general' | 'security' | 'provider';

/**
 * Represents the AI section of the settings view. The {@link view} input selects the slice a given
 * instance renders: General and Security & Permissions carry global agent settings, while `provider`
 * renders one company's page (selected by {@link providerId}) — a "Configurations" list where the user
 * adds one configuration per authentication method the company offers, each with its own credential and
 * model list. Configuration state is owned by {@link AiConnections}, which persists the collection and
 * keeps each key in the main process.
 */
@Component({
  selector: 'app-ai-settings',
  imports: [
    Button,
    Dropdown,
    SettingRow,
    SettingControl,
    AiConnectionEditor,
    AiRemoteNotifications,
    AiToolPolicies,
    AiNetworkLocations,
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
   * Gets which slice of the AI settings to render. Defaults to General.
   */
  public readonly view: InputSignal<AiSettingsView> = input<AiSettingsView>('general');

  /**
   * Gets the id of the company page to render when {@link view} is `provider` (for example `anthropic`).
   */
  public readonly providerId: InputSignal<string> = input<string>('');

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
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

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
   * Holds the ids of the currently-expanded configurations.
   */
  private readonly expandedIds: WritableSignal<ReadonlySet<string>> = signal<ReadonlySet<string>>(
    new Set<string>(),
  );

  /**
   * Gets the company page to render, resolved from {@link providerId}, or undefined when it names no
   * known page.
   */
  protected readonly page: Signal<ProviderPage | undefined> = computed(
    (): ProviderPage | undefined =>
      PROVIDER_PAGES.find((page: ProviderPage): boolean => page.id === this.providerId()),
  );

  /**
   * Gets the configurations shown on the current company page (every connection of its kind(s)).
   */
  protected readonly pageConnections: Signal<readonly AiConnection[]> = computed(
    (): readonly AiConnection[] => {
      const page: ProviderPage | undefined = this.page();
      return page === undefined ? [] : this.connectionsService.connectionsForKinds(page.kinds);
    },
  );

  /**
   * Gets a value indicating whether the agent bridge is available.
   */
  protected readonly isAvailable: boolean = this.connectionsService.isAvailable;

  /**
   * Initialises the section, refreshing every configuration's auth status.
   */
  public constructor() {
    void this.connectionsService.refreshAllAuth();
  }

  /**
   * Reports whether a configuration is expanded.
   * @param id The connection id.
   * @returns Returns true when the configuration is expanded.
   */
  protected isExpanded(id: string): boolean {
    return this.expandedIds().has(id);
  }

  /**
   * Toggles a configuration's expanded state.
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
   * Gets a configuration's auth status.
   * @param id The connection id.
   * @returns Returns the status.
   */
  protected status(id: string): AiAuthStatus {
    return this.connectionsService.authStatus(id);
  }

  /**
   * Adds a configuration to the current company page through the given authentication method and expands
   * it.
   * @param method The authentication method the configuration is added through.
   */
  protected addConfiguration(method: AuthMethod): void {
    const page: ProviderPage | undefined = this.page();
    if (page === undefined) {
      return;
    }
    const connection: AiConnection = this.connectionsService.add(page.createKind, method);
    this.log.info('settings.ai', 'Configuration added', connection.id, connection.auth);
    this.expandedIds.update((current: ReadonlySet<string>): ReadonlySet<string> =>
      new Set<string>(current).add(connection.id),
    );
  }

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
