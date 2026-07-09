import { computed, Service, signal, Signal, WritableSignal } from '@angular/core';
import type { AgentContextRef, AgentMode } from '@shared/api/ai-types';

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
   * Gets how much autonomy the conversation's runs use: `agent` (full tools) or `chat` (read-only).
   */
  readonly mode: Signal<AgentMode>;

  /**
   * Gets the files and folders attached to the conversation's context.
   */
  readonly contextPaths: Signal<readonly AgentContextRef[]>;

  /**
   * Gets a value indicating whether the conversation-history list is shown.
   */
  readonly historyOpen: Signal<boolean>;

  /**
   * Gets a value indicating whether the transcript follows new content to the bottom as it streams.
   */
  readonly autoScroll: Signal<boolean>;

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
   * Sets whether the transcript follows new content to the bottom as it streams.
   * @param value The new auto-scroll preference.
   */
  setAutoScroll(value: boolean): void;

  /**
   * Sets how much autonomy the conversation's runs use.
   * @param mode The new mode: `agent` (full tools) or `chat` (read-only).
   */
  setMode(mode: AgentMode): void;

  /**
   * Prompts for a file and attaches it to the conversation's context.
   */
  attachFile(): void;

  /**
   * Prompts for a folder and attaches it to the conversation's context.
   */
  attachFolder(): void;

  /**
   * Removes an attached file or folder from the conversation's context.
   * @param path The path to detach.
   */
  removeContext(path: string): void;

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
   * Gets a value indicating whether the active agent tab's run is in flight.
   */
  public readonly isRunning: Signal<boolean> = computed(
    (): boolean => this.activeSession()?.isRunning() ?? false,
  );

  /**
   * Gets a value indicating whether the active agent tab's conversation-history list is shown.
   */
  public readonly historyOpen: Signal<boolean> = computed(
    (): boolean => this.activeSession()?.historyOpen() ?? false,
  );

  /**
   * Gets a value indicating whether the active agent tab's transcript follows new content to the
   * bottom as it streams. Defaults to true when no agent tab is active.
   */
  public readonly autoScroll: Signal<boolean> = computed(
    (): boolean => this.activeSession()?.autoScroll() ?? true,
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
   * Registers the given session as the one the ribbon drives.
   * @param session The active agent tab's session.
   */
  public setActive(session: AgentSessionHandle): void {
    this.activeSession.set(session);
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
   * Sets whether the active agent tab's transcript follows new content to the bottom as it streams.
   * @param value The new auto-scroll preference.
   */
  public setAutoScroll(value: boolean): void {
    this.activeSession()?.setAutoScroll(value);
  }

  /**
   * Sets how much autonomy the active agent tab's runs use.
   * @param mode The new mode: `agent` (full tools) or `chat` (read-only).
   */
  public setMode(mode: AgentMode): void {
    this.activeSession()?.setMode(mode);
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
   * Removes an attached file or folder from the active agent tab's context.
   * @param path The path to detach.
   */
  public removeContext(path: string): void {
    this.activeSession()?.removeContext(path);
  }

  /**
   * Compacts the active agent tab's conversation.
   */
  public compact(): void {
    this.activeSession()?.compact();
  }
}
