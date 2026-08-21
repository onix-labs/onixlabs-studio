import { computed, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import type {
  AgentContextRef,
  AgentMode,
  AiModelInfo,
  AiProviderId,
  AiRemoteControlMode,
} from '@shared/api/ai-types';
import { Log } from '@shared/angular/services/log/log';

/**
 * The slice of an agent conversation the agent ribbon drives: whether a run is in flight, whether the
 * conversation-history list is shown, the autonomy mode, the attached context, and the
 * session/context/compact commands. Provided by the per-conversation
 * {@link import('../agent-conversation/agent-conversation').AgentConversation} host, which owns the
 * {@link Agent} session and the history view.
 */
export interface AgentSessionHandle {
  /**
   * Gets a value indicating whether a run is in flight.
   */
  readonly isRunning: Signal<boolean>;

  /**
   * Gets the connection the conversation's runs go through.
   */
  readonly provider: Signal<AiProviderId>;

  /**
   * Gets the model the conversation's runs go through.
   */
  readonly model: Signal<string>;

  /**
   * Gets the models offered by the conversation's effective provider.
   */
  readonly models: Signal<readonly AiModelInfo[]>;

  /**
   * Gets whether the conversation's provider supports Remote Control.
   */
  readonly supportsRemoteControl: Signal<boolean>;

  /**
   * Gets whether the conversation's session is exposed via Remote Control.
   */
  readonly remoteControlEnabled: Signal<boolean>;

  /**
   * Gets the mode the conversation's session is exposed at — `off`, or the user's global Remote
   * control posture while it is exposed.
   */
  readonly remoteControl: Signal<AiRemoteControlMode>;

  /**
   * Gets how much autonomy the conversation's runs use: `agent` (full tools) or `chat` (read-only).
   */
  readonly mode: Signal<AgentMode>;

  /**
   * Gets the files and folders attached to the conversation's context.
   */
  readonly contextPaths: Signal<readonly AgentContextRef[]>;

  /**
   * Gets a value indicating whether the conversation has any messages, so controls that act on the
   * transcript (such as New and Compact) can disable on an empty conversation.
   */
  readonly hasMessages: Signal<boolean>;

  /**
   * Gets a value indicating whether the conversation-history list is shown.
   */
  readonly historyOpen: Signal<boolean>;

  /**
   * Starts a fresh conversation (clearing the transcript and leaving history).
   */
  newChat(): void;

  /**
   * Stops the in-flight run.
   */
  stop(): void;

  /**
   * Toggles the conversation-history list.
   */
  toggleHistory(): void;

  /**
   * Sets how much autonomy the conversation's runs use.
   * @param mode The new mode: `agent` (full tools) or `chat` (read-only).
   */
  setMode(mode: AgentMode): void;

  /**
   * Selects the connection the conversation's runs go through.
   * @param id The connection id.
   */
  setProvider(id: AiProviderId): void;

  /**
   * Selects the model the conversation's runs go through.
   * @param id The model id.
   */
  setModel(id: string): void;

  /**
   * Exposes the conversation's session via Remote Control, or stops exposing it.
   * @param enabled Whether the session is exposed.
   */
  setRemoteControlEnabled(enabled: boolean): void;

  /**
   * Prompts for a file and attaches it to the conversation's context.
   */
  attachFile(): void;

  /**
   * Prompts for a folder and attaches it to the conversation's context.
   */
  attachFolder(): void;

  /**
   * Attaches the current editor selection to the conversation's context. Does nothing when no code
   * editor has a selection.
   */
  attachSelection(): void;

  /**
   * Removes an attached file or folder from the conversation's context.
   * @param path The path to detach.
   */
  removeContext(path: string): void;

  /**
   * Removes everything attached to the conversation's context.
   */
  clearContext(): void;

  /**
   * Compacts the conversation, replacing the transcript with a concise summary.
   */
  compact(): void;
}

/**
 * Tracks the agent session belonging to the active agent tab so the contextual agent ribbon's
 * Session group (New Chat, Stop) and the AgentEngine-independent run state can drive it without
 * reaching into the per-tab component tree. The active agent view registers itself while it is the
 * active tab and deregisters when it is not, mirroring how the terminal ribbon drives the active
 * terminal through the terminal commands registry.
 */
@Service()
export class AgentSessions {
  /**
   * Holds the session belonging to the active agent tab, or null when no agent tab is active.
   */
  private readonly activeSession: WritableSignal<AgentSessionHandle | null> =
    signal<AgentSessionHandle | null>(null);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets a value indicating whether the active agent tab's run is in flight.
   */
  public readonly isRunning: Signal<boolean> = computed(
    (): boolean => this.activeSession()?.isRunning() ?? false,
  );

  /**
   * Gets the connection the active agent tab's runs go through.
   */
  public readonly provider: Signal<AiProviderId> = computed(
    (): AiProviderId => this.activeSession()?.provider() ?? '',
  );

  /**
   * Gets the model the active agent tab's runs go through.
   */
  public readonly model: Signal<string> = computed(
    (): string => this.activeSession()?.model() ?? '',
  );

  /**
   * Gets the models offered by the active agent tab's effective provider.
   */
  public readonly models: Signal<readonly AiModelInfo[]> = computed(
    (): readonly AiModelInfo[] => this.activeSession()?.models() ?? [],
  );

  /**
   * Gets whether the active agent tab's provider supports Remote Control. False when no tab is active.
   */
  public readonly supportsRemoteControl: Signal<boolean> = computed(
    (): boolean => this.activeSession()?.supportsRemoteControl() ?? false,
  );

  /**
   * Gets whether the active agent tab's session is exposed via Remote Control. False when no tab is
   * active.
   */
  public readonly remoteControlEnabled: Signal<boolean> = computed(
    (): boolean => this.activeSession()?.remoteControlEnabled() ?? false,
  );

  /**
   * Gets the mode the active agent tab's session is exposed at. `off` when no tab is active.
   */
  public readonly remoteControl: Signal<AiRemoteControlMode> = computed(
    (): AiRemoteControlMode => this.activeSession()?.remoteControl() ?? 'off',
  );

  /**
   * Gets a value indicating whether the active agent tab's conversation-history list is shown.
   */
  public readonly historyOpen: Signal<boolean> = computed(
    (): boolean => this.activeSession()?.historyOpen() ?? false,
  );

  /**
   * Gets how much autonomy the active agent tab's runs use. Defaults to `agent` when no tab is active.
   */
  public readonly mode: Signal<AgentMode> = computed(
    (): AgentMode => this.activeSession()?.mode() ?? 'agent',
  );

  /**
   * Gets the files and folders attached to the active agent tab's context. Empty when no tab is active.
   */
  public readonly contextPaths: Signal<readonly AgentContextRef[]> = computed(
    (): readonly AgentContextRef[] => this.activeSession()?.contextPaths() ?? [],
  );

  /**
   * Gets a value indicating whether the active agent tab's conversation has any messages. False when
   * no tab is active, so transcript controls (New, Compact) stay disabled.
   */
  public readonly hasMessages: Signal<boolean> = computed(
    (): boolean => this.activeSession()?.hasMessages() ?? false,
  );

  /**
   * Registers the given session as the one the ribbon drives.
   * @param session The active agent tab's session.
   */
  public setActive(session: AgentSessionHandle): void {
    this.activeSession.set(session);
    this.log.trace('AgentSessions', 'Active session registered');
  }

  /**
   * Deregisters the given session if it is the active one, leaving any newer registration intact.
   * @param session The session being deactivated or destroyed.
   */
  public clearActive(session: AgentSessionHandle): void {
    if (this.activeSession() === session) {
      this.activeSession.set(null);
    }
  }

  /**
   * Starts a fresh conversation in the active agent tab.
   */
  public newChat(): void {
    this.log.info('AgentSessions', 'New chat requested for active session');
    this.activeSession()?.newChat();
  }

  /**
   * Stops the active agent tab's in-flight run.
   */
  public stop(): void {
    this.activeSession()?.stop();
  }

  /**
   * Toggles the active agent tab's conversation-history list.
   */
  public toggleHistory(): void {
    this.activeSession()?.toggleHistory();
  }

  /**
   * Sets how much autonomy the active agent tab's runs use.
   * @param mode The new mode: `agent` (full tools) or `chat` (read-only).
   */
  public setMode(mode: AgentMode): void {
    this.activeSession()?.setMode(mode);
  }

  /**
   * Selects the connection the active agent tab's runs go through.
   * @param id The connection id.
   */
  public setProvider(id: AiProviderId): void {
    this.activeSession()?.setProvider(id);
  }

  /**
   * Selects the model the active agent tab's runs go through.
   * @param id The model id.
   */
  public setModel(id: string): void {
    this.activeSession()?.setModel(id);
  }

  /**
   * Exposes the active agent tab's session via Remote Control, or stops exposing it.
   * @param enabled Whether the session is exposed.
   */
  public setRemoteControlEnabled(enabled: boolean): void {
    this.activeSession()?.setRemoteControlEnabled(enabled);
  }

  /**
   * Prompts for a file and attaches it to the active agent tab's context.
   */
  public attachFile(): void {
    this.activeSession()?.attachFile();
  }

  /**
   * Prompts for a folder and attaches it to the active agent tab's context.
   */
  public attachFolder(): void {
    this.activeSession()?.attachFolder();
  }

  /**
   * Attaches the current editor selection to the active agent tab's context.
   */
  public attachSelection(): void {
    this.activeSession()?.attachSelection();
  }

  /**
   * Removes an attached file or folder from the active agent tab's context.
   * @param path The path to detach.
   */
  public removeContext(path: string): void {
    this.activeSession()?.removeContext(path);
  }

  /**
   * Removes everything attached to the active agent tab's context.
   */
  public clearContext(): void {
    this.activeSession()?.clearContext();
  }

  /**
   * Compacts the active agent tab's conversation.
   */
  public compact(): void {
    this.activeSession()?.compact();
  }
}
