import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import type { InputSignal, Signal, WritableSignal } from '@angular/core';
import type {
  AiAuthKind,
  AiAuthStatus,
  AiConnection,
  AiModelInfo,
  AiProviderKind,
} from '@shared/api/ai-types';
import { AiConnections } from '@shared/angular/services/ai-connections/ai-connections';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { PasswordField } from '@shared/angular/components/forms/password-field/password-field';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Button } from '@shared/angular/components/forms/button/button';
import { Icon } from '@shared/angular/icons/icon';

/**
 * The provider-kind options offered when configuring a connection.
 */
const KIND_OPTIONS: readonly DropdownOption[] = [
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'xai', label: 'xAI (Grok)' },
  { value: 'google', label: 'Google (Gemini)' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'ollama', label: 'Ollama (local)' },
  { value: 'openai-compatible', label: 'OpenAI-compatible' },
  { value: 'custom', label: 'Custom' },
];

/**
 * The auth-kind options offered for a connection. `claude-login` routes the connection through the
 * Claude Agent SDK using the user's local `~/.claude` login.
 */
const AUTH_OPTIONS: readonly DropdownOption[] = [
  { value: 'api-key', label: 'API key' },
  { value: 'none', label: 'None' },
  { value: 'claude-login', label: 'Local Claude login' },
];

/**
 * Edits a single AI provider connection: its label, kind, base URL, credential, and model list (with
 * discovery, manual entry, pinning, hiding, removal, and default selection). All changes are applied
 * through {@link AiConnections}, which persists the connection and keeps the key in the main process.
 */
@Component({
  selector: 'app-ai-connection-editor',
  imports: [Button, Dropdown, TextField, PasswordField, AppIcon],
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
   * Gets the provider-kind options.
   */
  protected readonly kindOptions: readonly DropdownOption[] = KIND_OPTIONS;

  /**
   * Gets the auth-kind options.
   */
  protected readonly authOptions: readonly DropdownOption[] = AUTH_OPTIONS;

  /**
   * Holds the connection-management service.
   */
  private readonly connections: AiConnections = inject(AiConnections);

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
   * Gets a value indicating whether the connection authenticates with an API key.
   */
  protected readonly usesKey: Signal<boolean> = computed(
    (): boolean => this.connection().auth === 'api-key',
  );

  /**
   * Gets a value indicating whether the connection uses the local Claude login.
   */
  protected readonly usesLocalLogin: Signal<boolean> = computed(
    (): boolean => this.connection().auth === 'claude-login',
  );

  /**
   * Gets a value indicating whether a base URL field applies to the connection's kind.
   */
  protected readonly showBaseUrl: Signal<boolean> = computed((): boolean => {
    const kind: AiProviderKind = this.connection().kind;
    return kind === 'openai-compatible' || kind === 'custom' || kind === 'ollama';
  });

  /**
   * Gets the default-model options (every model the connection offers).
   */
  protected readonly modelOptions: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] =>
      this.connection().models.map(
        (model: AiModelInfo): DropdownOption => ({ value: model.id, label: model.label }),
      ),
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
   * Renames the connection.
   * @param label The new label.
   */
  protected onLabel(label: string): void {
    this.connections.update(this.connection().id, { label });
  }

  /**
   * Changes the connection's kind.
   * @param kind The new kind.
   */
  protected onKind(kind: string): void {
    this.connections.update(this.connection().id, { kind: kind as AiProviderKind });
  }

  /**
   * Changes the connection's auth kind.
   * @param auth The new auth kind.
   */
  protected onAuthKind(auth: string): void {
    this.connections.setAuthKind(this.connection().id, auth as AiAuthKind);
  }

  /**
   * Sets the connection's base URL.
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
    try {
      await this.connections.setKey(this.connection(), key);
      this.apiKeyDraft.set('');
    } finally {
      this.keyBusy.set(false);
    }
  }

  /**
   * Clears the connection's stored API key.
   * @returns Returns a promise that resolves once the key is cleared.
   */
  protected async clearKey(): Promise<void> {
    if (this.keyBusy()) {
      return;
    }
    this.keyBusy.set(true);
    try {
      await this.connections.clearKey(this.connection());
    } finally {
      this.keyBusy.set(false);
    }
  }

  /**
   * Discovers the connection's models from its endpoint.
   * @returns Returns a promise that resolves once discovery completes.
   */
  protected async refresh(): Promise<void> {
    if (this.discovering()) {
      return;
    }
    this.discovering.set(true);
    this.discoverDetail.set(null);
    try {
      const detail: string | null =
        (await this.connections.discover(this.connection()))?.detail ?? null;
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
    this.connections.addModel(this.connection(), this.newModelDraft());
    this.newModelDraft.set('');
  }

  /**
   * Removes a model.
   * @param modelId The model id.
   */
  protected removeModel(modelId: string): void {
    this.connections.removeModel(this.connection(), modelId);
  }

  /**
   * Toggles a model's pinned flag.
   * @param modelId The model id.
   */
  protected togglePin(modelId: string): void {
    this.connections.togglePinned(this.connection(), modelId);
  }

  /**
   * Toggles a model's hidden flag.
   * @param modelId The model id.
   */
  protected toggleHide(modelId: string): void {
    this.connections.toggleHidden(this.connection(), modelId);
  }

  /**
   * Sets the connection's default model.
   * @param modelId The model id.
   */
  protected setDefault(modelId: string): void {
    this.connections.setDefaultModel(this.connection(), modelId);
  }

  /**
   * Removes the connection.
   */
  protected removeConnection(): void {
    this.connections.remove(this.connection().id);
  }
}
