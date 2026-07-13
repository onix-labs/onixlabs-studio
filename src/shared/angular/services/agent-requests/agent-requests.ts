import { computed, Service, signal, Signal, WritableSignal } from '@angular/core';
import type { Agent, AgentItem } from '@shared/angular/services/agent/agent';

/**
 * A registered conversation the requests registry watches: its agent session, plus how to attribute
 * its requests (the hosting tab and a display label, read lazily so they stay current).
 */
export interface AgentRequestSource {
  /**
   * Gets the conversation's agent session.
   */
  readonly agent: Agent;

  /**
   * Gets the identifier of the hosting tab, or null when the host has no owning tab (the workspace
   * and repository agent panels).
   */
  readonly tabId: () => string | null;

  /**
   * Gets the display label the source's requests are attributed to (the tab title, or a panel name).
   */
  readonly label: () => string;
}

/**
 * A pending agent request surfaced app-wide: the transcript item awaiting the user (a permission, a
 * question, or an edit decision), attributed to its hosting conversation.
 */
export interface AgentRequestEntry {
  /**
   * Gets the entry's stable identity for tracking.
   */
  readonly key: string;

  /**
   * Gets the identifier of the hosting tab, or null when the host has no owning tab.
   */
  readonly tabId: string | null;

  /**
   * Gets the display label the request is attributed to.
   */
  readonly label: string;

  /**
   * Gets the pending transcript item.
   */
  readonly item: AgentItem;

  /**
   * Gets the agent session the item belongs to, used to answer it from the list.
   */
  readonly agent: Agent;
}

/**
 * The app-wide registry of pending agent requests (#253): every hosted conversation registers here,
 * and the title strip's tab menu surfaces each source's pending permissions, questions, and edit
 * decisions with inline actions. Answering from the list drives the same respond methods on the same
 * items, so the origin transcript settles simultaneously — one source of truth. Entries vanish as
 * they settle because they are computed live from each agent's transcript.
 */
@Service()
export class AgentRequests {
  /**
   * Holds the registered conversation sources.
   */
  private readonly sources: WritableSignal<readonly AgentRequestSource[]> = signal<
    readonly AgentRequestSource[]
  >([]);

  /**
   * Gets every pending agent request across the registered conversations, in registration order.
   */
  public readonly entries: Signal<readonly AgentRequestEntry[]> = computed(
    (): readonly AgentRequestEntry[] =>
      this.sources().flatMap(
        (source: AgentRequestSource, index: number): readonly AgentRequestEntry[] =>
          source.agent
            .items()
            .filter((item: AgentItem): boolean => this.isPending(item))
            .map(
              (item: AgentItem): AgentRequestEntry => ({
                key: `${index}:${item.id}`,
                tabId: source.tabId(),
                label: source.label(),
                item,
                agent: source.agent,
              }),
            ),
      ),
  );

  /**
   * Gets the number of pending requests, driving the title-strip bell.
   */
  public readonly count: Signal<number> = computed((): number => this.entries().length);

  /**
   * Gets the identifiers of the tabs with pending requests, so tab lists can mark them.
   */
  public readonly tabIds: Signal<ReadonlySet<string>> = computed(
    (): ReadonlySet<string> =>
      new Set<string>(
        this.entries()
          .map((entry: AgentRequestEntry): string | null => entry.tabId)
          .filter((tabId: string | null): tabId is string => tabId !== null),
      ),
  );

  /**
   * Registers a conversation with the registry.
   * @param source The conversation source.
   * @returns Returns a function that unregisters it.
   */
  public register(source: AgentRequestSource): () => void {
    this.sources.update((current: readonly AgentRequestSource[]): readonly AgentRequestSource[] => [
      ...current,
      source,
    ]);
    return (): void => {
      this.sources.update((current: readonly AgentRequestSource[]): readonly AgentRequestSource[] =>
        current.filter((existing: AgentRequestSource): boolean => existing !== source),
      );
    };
  }

  /**
   * Determines whether a transcript item is a request awaiting the user.
   * @param item The item to test.
   * @returns Returns true when the item is pending.
   */
  private isPending(item: AgentItem): boolean {
    return (
      (item.kind === 'permission' && item.permissionState === 'pending') ||
      (item.kind === 'input-request' && item.inputState === 'pending') ||
      (item.kind === 'edit-decision' && item.decisionState === 'pending')
    );
  }
}
