import { computed, Service, signal, Signal, WritableSignal } from '@angular/core';

/**
 * The slice of an agent conversation the agent ribbon's Session group drives: whether a run is in
 * flight, whether the conversation-history list is shown, and the new-chat/stop/history commands.
 * Provided by the per-conversation {@link import('../../components/agent-chat/agent-chat').AgentChat}
 * host, which owns both the {@link Agent} session and the history view.
 */
export interface AgentSessionHandle {
  /**
   * Gets a value indicating whether a run is in flight.
   */
  readonly isRunning: Signal<boolean>;

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
}
