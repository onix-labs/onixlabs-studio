import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import type {
  AiAuthStatus,
  AiModelInfo,
  AiProviderId,
  AiProviderInfo,
  AiVerifyResult,
} from '../../../../../../shared/ai-types';
import { AgentEngine } from '../../../../../services/agent-engine/agent-engine';
import { AiAuth } from '../../../../../services/ai-auth/ai-auth';
import { Dropdown, DropdownOption } from '../../../../forms/dropdown/dropdown';
import { PasswordField } from '../../../../forms/password-field/password-field';
import { SettingRow } from '../../../../forms/setting-row/setting-row';
import { SettingControl } from '../../setting-control/setting-control';
import { Icon } from '../../../../../icons/icon';
import { AppIcon } from '../../../../shared/icon/app-icon';

/**
 * Represents the AI section of the settings view: provider and per-provider model selection, the
 * authentication state (with an API-key entry and an end-to-end verification check), the default
 * permission posture, and the per-request token cap. Provider/model selection is shared with the agent
 * through {@link AgentEngine} (both persist via {@link Settings}); auth is driven through
 * {@link AiAuth}, which keeps the key in the main process.
 */
@Component({
  selector: 'app-ai-settings',
  imports: [SettingRow, Dropdown, PasswordField, AppIcon, SettingControl],
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
   * Holds the engine service, the shared source of provider/model selection.
   */
  private readonly engine: AgentEngine = inject(AgentEngine);

  /**
   * Holds the agent authentication service.
   */
  private readonly aiAuth: AiAuth = inject(AiAuth);

  /**
   * Holds the API-key draft entered in the field but not yet saved.
   */
  private readonly apiKeyDraft: WritableSignal<string> = signal<string>('');

  /**
   * Holds a value indicating whether a key operation (save/clear) is in flight.
   */
  private readonly keyBusy: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds a value indicating whether a verification check is in flight.
   */
  private readonly verifying: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the latest verification result, or null when none has run.
   */
  private readonly verifyOutcome: WritableSignal<AiVerifyResult | null> =
    signal<AiVerifyResult | null>(null);

  /**
   * Gets a value indicating whether the agent bridge is available (running inside Studio).
   */
  protected readonly isAvailable: boolean = this.aiAuth.isAvailable;

  /**
   * Gets the current authentication status.
   */
  protected readonly authStatus: Signal<AiAuthStatus> = this.aiAuth.status;

  /**
   * Gets the selected provider.
   */
  protected readonly provider: Signal<AiProviderId> = this.engine.provider;

  /**
   * Gets the selected model.
   */
  protected readonly model: Signal<string> = this.engine.model;

  /**
   * Gets the API-key draft.
   */
  protected readonly apiKey: Signal<string> = this.apiKeyDraft.asReadonly();

  /**
   * Gets a value indicating whether a key operation is in flight.
   */
  protected readonly keyPending: Signal<boolean> = this.keyBusy.asReadonly();

  /**
   * Gets a value indicating whether a verification check is in flight.
   */
  protected readonly isVerifying: Signal<boolean> = this.verifying.asReadonly();

  /**
   * Gets the latest verification result, or null when none has run.
   */
  protected readonly verifyResult: Signal<AiVerifyResult | null> = this.verifyOutcome.asReadonly();

  /**
   * Gets the provider options for the provider dropdown.
   */
  protected readonly providerOptions: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] =>
      this.engine
        .providers()
        .map((info: AiProviderInfo): DropdownOption => ({ value: info.id, label: info.label })),
  );

  /**
   * Gets the model options for the model dropdown.
   */
  protected readonly modelOptions: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] =>
      this.engine
        .models()
        .map((info: AiModelInfo): DropdownOption => ({ value: info.id, label: info.label })),
  );

  /**
   * Initialises the section, refreshing the authentication status.
   */
  public constructor() {
    void this.aiAuth.refresh();
  }

  /**
   * Selects the provider.
   * @param id The provider id.
   */
  protected onProviderChange(id: string): void {
    this.engine.setProvider(id as AiProviderId);
  }

  /**
   * Selects the model for the active provider.
   * @param id The model id.
   */
  protected onModelChange(id: string): void {
    this.engine.setModel(id);
  }

  /**
   * Records the API-key draft.
   * @param value The new draft value.
   */
  protected onApiKeyInput(value: string): void {
    this.apiKeyDraft.set(value);
  }

  /**
   * Stores the entered API key and clears the field. Blank drafts are ignored.
   * @returns Returns a promise that resolves once the key has been stored.
   */
  protected async saveApiKey(): Promise<void> {
    const key: string = this.apiKeyDraft().trim();
    if (key.length === 0 || this.keyBusy()) {
      return;
    }
    this.keyBusy.set(true);
    try {
      await this.aiAuth.setApiKey(key);
      this.apiKeyDraft.set('');
    } finally {
      this.keyBusy.set(false);
    }
  }

  /**
   * Clears any stored API key.
   * @returns Returns a promise that resolves once the key has been cleared.
   */
  protected async clearApiKey(): Promise<void> {
    if (this.keyBusy()) {
      return;
    }
    this.keyBusy.set(true);
    try {
      await this.aiAuth.clearApiKey();
    } finally {
      this.keyBusy.set(false);
    }
  }

  /**
   * Runs an end-to-end authentication check and records the outcome.
   * @returns Returns a promise that resolves once the check completes.
   */
  protected async verify(): Promise<void> {
    if (this.verifying()) {
      return;
    }
    this.verifying.set(true);
    this.verifyOutcome.set(null);
    try {
      this.verifyOutcome.set(await this.aiAuth.verifyAuthentication());
    } finally {
      this.verifying.set(false);
    }
  }
}
