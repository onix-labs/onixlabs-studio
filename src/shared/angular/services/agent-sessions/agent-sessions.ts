import { computed, Service, signal, Signal, WritableSignal } from '@angular/core';

/**
 * The slice of an agent session the ribbon's Session group drives: whether a run is in flight, and
 * the clear/stop commands. Implemented by the per-tab {@link Agent} session.
 */
export interface AgentSessionHandle {
  /**
   * Gets a value indicating whether a run is in flight.
   */
  readonly isRunning: Signal<boolean>;

  /**
   * Clears the transcript, starting a fresh conversation.
   */
  clear(): void;

  /**
   * Stops the in-flight run.
   */
  stop(): void;
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
   * Starts a fresh conversation in the active agent tab by clearing its transcript.
   */
  public newChat(): void {
    this.activeSession()?.clear();
  }

  /**
   * Stops the active agent tab's in-flight run.
   */
  public stop(): void {
    this.activeSession()?.stop();
  }
}
