import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import type { InputSignal, Signal, WritableSignal } from '@angular/core';
import type { AiAuthStatus, AiConnection, AiProviderKind } from '@shared/api/ai-types';
import { AiConnections } from '@shared/angular/services/ai-connections/ai-connections';
import { Settings } from '@shared/angular/services/settings/settings';
import { Log } from '@shared/angular/services/log/log';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { PasswordField } from '@shared/angular/components/forms/password-field/password-field';
import { Radio } from '@shared/angular/components/forms/radio/radio';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { Button } from '@shared/angular/components/forms/button/button';
import { Icon } from '@shared/angular/icons/icon';
import { SettingControl } from '../../../setting-control/setting-control';

/**
 * Edits a single AI provider configuration (a connection) inside its company page's accordion. Its
 * identity — the company (kind) and authentication method — is fixed when the configuration is created,
 * so the editor exposes only what a configuration owns: its display name, its credential (an API key, or
 * a hint for a subscription/local method), a base URL for endpoint-addressed kinds, the Claude CLI a
 * Claude subscription discovers and runs through, and its model list (discovery, manual entry, default
 * selection, and removal). All changes are applied through {@link AiConnections}, which persists the
 * connection and keeps any key in the main process.
 */
@Component({
  selector: 'app-ai-connection-editor',
  imports: [Button, TextField, PasswordField, Radio, SettingRow, SettingControl],
  templateUrl: './ai-connection-editor.html',
  styleUrls: ['./ai-connection-editor.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiConnectionEditor {
  /**
   * Gets the connection being edited.
   */
  public readonly connection: InputSignal<AiConnection> = input.required<AiConnection>();

  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the connection-management service.
   */
  private readonly connections: AiConnections = inject(AiConnections);

  /**
   * Holds the settings service, backing the Claude CLI rows shown for a Claude subscription.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the API-key draft entered but not yet saved.
   */
  protected readonly apiKeyDraft: WritableSignal<string> = signal<string>('');

  /**
   * Holds the manual model-id draft entered but not yet added.
   */
  protected readonly newModelDraft: WritableSignal<string> = signal<string>('');

  /**
   * Holds a value indicating whether a key operation is in flight.
   */
  protected readonly keyBusy: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds a value indicating whether model discovery is in flight.
   */
  protected readonly discovering: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the latest discovery outcome detail, or null when none has run.
   */
  protected readonly discoverDetail: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Gets a value indicating whether the agent bridge is available.
   */
  protected readonly isAvailable: boolean = this.connections.isAvailable;

  /**
   * Gets the connection's current auth status.
   */
  protected readonly status: Signal<AiAuthStatus> = computed(
    (): AiAuthStatus => this.connections.authStatus(this.connection().id),
  );

  /**
   * Gets a value indicating whether the configuration authenticates with an API key.
   */
  protected readonly usesKey: Signal<boolean> = computed(
    (): boolean => this.connection().auth === 'api-key',
  );

  /**
   * Gets a value indicating whether the configuration runs through the Claude subscription (local login).
   */
  protected readonly usesClaudeLogin: Signal<boolean> = computed(
    (): boolean => this.connection().auth === 'claude-login',
  );

  /**
   * Gets a short hint describing the configuration's credential, shown above the fields.
   */
  protected readonly credentialHint: Signal<string> = computed((): string => {
    switch (this.connection().auth) {
      case 'claude-login':
        return 'Uses your local Claude login (~/.claude) through the Claude Agent SDK.';
      case 'codex-login':
        return 'Uses your local Codex login (~/.codex) through the OpenAI Codex CLI.';
      case 'api-key':
        return 'Uses an API key, stored encrypted on this machine.';
      default:
        return 'No credentials required.';
    }
  });

  /**
   * Gets a value indicating whether a base URL field applies to the configuration's kind (an endpoint-
   * addressed kind: a custom OpenAI-compatible endpoint, or Ollama).
   */
  protected readonly showBaseUrl: Signal<boolean> = computed((): boolean => {
    const kind: AiProviderKind = this.connection().kind;
    return kind === 'openai-compatible' || kind === 'custom' || kind === 'ollama';
  });

  /**
   * Gets a value indicating whether the Claude CLI path row applies (only when the CLI choice is Custom).
   */
  protected readonly showClaudePath: Signal<boolean> = computed(
    (): boolean => this.settings.aiClaudeExecutable() === 'custom',
  );

  /**
   * Formats a context window as a compact token count (for example `128k` or `1M`).
   * @param tokens The context window in tokens.
   * @returns Returns the formatted string.
   */
  protected formatContext(tokens: number): string {
    return tokens >= 1_000_000
      ? `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`
      : `${Math.round(tokens / 1000)}k`;
  }

  /**
   * Renames the configuration.
   * @param label The new display name.
   */
  protected onLabel(label: string): void {
    this.connections.update(this.connection().id, { label });
  }

  /**
   * Sets the configuration's base URL.
   * @param baseUrl The new base URL.
   */
  protected onBaseUrl(baseUrl: string): void {
    this.connections.update(this.connection().id, { baseUrl });
  }

  /**
   * Records the API-key draft.
   * @param value The draft value.
   */
  protected onApiKeyInput(value: string): void {
    this.apiKeyDraft.set(value);
  }

  /**
   * Stores the entered API key and clears the field.
   * @returns Returns a promise that resolves once the key is stored.
   */
  protected async saveKey(): Promise<void> {
    const key: string = this.apiKeyDraft().trim();
    if (key.length === 0 || this.keyBusy()) {
      return;
    }
    this.keyBusy.set(true);
    this.log.info('settings.ai', 'Storing connection API key', this.connection().id);
    try {
      await this.connections.setKey(this.connection(), key);
      this.apiKeyDraft.set('');
    } finally {
      this.keyBusy.set(false);
    }
  }

  /**
   * Clears the configuration's stored API key.
   * @returns Returns a promise that resolves once the key is cleared.
   */
  protected async clearKey(): Promise<void> {
    if (this.keyBusy()) {
      return;
    }
    this.keyBusy.set(true);
    this.log.info('settings.ai', 'Clearing connection API key', this.connection().id);
    try {
      await this.connections.clearKey(this.connection());
    } finally {
      this.keyBusy.set(false);
    }
  }

  /**
   * Discovers the configuration's models from its endpoint, replacing its list with the result.
   * @returns Returns a promise that resolves once discovery completes.
   */
  protected async refresh(): Promise<void> {
    if (this.discovering()) {
      return;
    }
    this.discovering.set(true);
    this.discoverDetail.set(null);
    this.log.info('settings.ai', 'Discovering connection models', this.connection().id);
    try {
      const detail: string | null =
        (await this.connections.discover(this.connection()))?.detail ?? null;
      this.log.debug('settings.ai', 'Model discovery completed', this.connection().id, detail);
      this.discoverDetail.set(detail);
    } finally {
      this.discovering.set(false);
    }
  }

  /**
   * Records the manual model-id draft.
   * @param value The draft value.
   */
  protected onNewModelInput(value: string): void {
    this.newModelDraft.set(value);
  }

  /**
   * Adds the manually-entered model.
   */
  protected addModel(): void {
    this.log.info('settings.ai', 'Model added', this.connection().id, this.newModelDraft());
    this.connections.addModel(this.connection(), this.newModelDraft());
    this.newModelDraft.set('');
  }

  /**
   * Removes a model.
   * @param modelId The model id.
   */
  protected removeModel(modelId: string): void {
    this.log.info('settings.ai', 'Model removed', this.connection().id, modelId);
    this.connections.removeModel(this.connection(), modelId);
  }

  /**
   * Sets the configuration's default model when its radio is selected.
   * @param modelId The model id.
   * @param checked Whether the model's radio became selected.
   */
  protected onDefaultChange(modelId: string, checked: boolean): void {
    if (!checked) {
      return;
    }
    this.log.info('settings.ai', 'Default model set', this.connection().id, modelId);
    this.connections.setDefaultModel(this.connection(), modelId);
  }

  /**
   * Removes the configuration.
   */
  protected removeConnection(): void {
    this.log.info('settings.ai', 'Configuration removed', this.connection().id);
    this.connections.remove(this.connection().id);
  }
}
