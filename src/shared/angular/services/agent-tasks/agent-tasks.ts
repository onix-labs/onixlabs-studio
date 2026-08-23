import { computed, Service, Signal, signal, WritableSignal } from '@angular/core';
import { AgentTask } from '@shared/angular/services/agent/agent';

/**
 * A live task together with the conversation running it, so a surface can name the agent doing the
 * work and take the user to it.
 */
export interface LiveAgentTask extends AgentTask {
  /**
   * Gets the identifier of the conversation running the task.
   */
  readonly ownerId: string;

  /**
   * Gets the display name of the conversation running the task — its tab's title, or a fallback for a
   * conversation with no tab of its own (a docked agent panel).
   */
  readonly ownerTitle: string;

  /**
   * Gets the tab hosting the conversation, when it has one, so the row can reveal it.
   */
  readonly ownerTabId?: string;
}

/**
 * What a conversation contributes to the registry: its live tasks, how to name it, and how to act on
 * one of its tasks. Modelled as callbacks rather than an `Agent` reference so the registry does not
 * depend on the conversation implementation (and so tests can register a plain stub).
 */
export interface AgentTaskOwner {
  /**
   * Gets the conversation's live tasks.
   */
  readonly tasks: Signal<readonly AgentTask[]>;

  /**
   * Gets the conversation's display name.
   * @returns Returns the title to show against its tasks.
   */
  title(): string;

  /**
   * Gets the tab hosting the conversation, when it has one.
   * @returns Returns the tab identifier, or undefined for a conversation with no tab.
   */
  tabId(): string | undefined;

  /**
   * Brings the conversation on screen.
   */
  reveal(): void;

  /**
   * Asks the provider to stop one of the conversation's tasks.
   * @param taskId The task to stop.
   */
  stop(taskId: string): void;
}

/**
 * Aggregates every live conversation's running tasks into one app-wide view.
 *
 * A backgrounded task outlives both the turn that launched it and the tab it was launched from, so the
 * surface that reports on it has to be reachable from anywhere — the count belongs beside the
 * notification bell, not inside the agent view. That makes this genuinely ambient state in the sense
 * the status strip means it: true no matter which tab is in front.
 *
 * Conversations register themselves and drop out when destroyed, so the registry can never describe an
 * agent that no longer exists.
 */
@Service()
export class AgentTasks {
  /**
   * Holds the registered conversations, keyed by their conversation id.
   */
  private readonly owners: WritableSignal<ReadonlyMap<string, AgentTaskOwner>> = signal<
    ReadonlyMap<string, AgentTaskOwner>
  >(new Map<string, AgentTaskOwner>());

  /**
   * Gets every live task across every conversation, each attributed to the agent running it. Ambient
   * housekeeping tasks are included: this is the surface they were kept in the registry for.
   */
  public readonly tasks: Signal<readonly LiveAgentTask[]> = computed(
    (): readonly LiveAgentTask[] => {
      const all: LiveAgentTask[] = [];
      for (const [ownerId, owner] of this.owners()) {
        const tabId: string | undefined = owner.tabId();
        for (const task of owner.tasks()) {
          all.push({
            ...task,
            ownerId,
            ownerTitle: owner.title(),
            ...(tabId === undefined ? {} : { ownerTabId: tabId }),
          });
        }
      }
      return all;
    },
  );

  /**
   * Gets how many live tasks the app is running, which is what the strip's indicator counts. Ambient
   * housekeeping is excluded — it is listed, but never advertised.
   */
  public readonly count: Signal<number> = computed(
    (): number =>
      this.tasks().filter((task: LiveAgentTask): boolean => !task.skipTranscript).length,
  );

  /**
   * Registers a conversation's tasks with the registry.
   * @param ownerId The conversation's identifier.
   * @param owner The conversation's contribution.
   * @returns Returns a function that unregisters it.
   */
  public register(ownerId: string, owner: AgentTaskOwner): () => void {
    this.owners.update(
      (owners: ReadonlyMap<string, AgentTaskOwner>): ReadonlyMap<string, AgentTaskOwner> =>
        new Map<string, AgentTaskOwner>(owners).set(ownerId, owner),
    );
    return (): void => {
      this.owners.update(
        (owners: ReadonlyMap<string, AgentTaskOwner>): ReadonlyMap<string, AgentTaskOwner> => {
          const next: Map<string, AgentTaskOwner> = new Map<string, AgentTaskOwner>(owners);
          // Only drop the entry this registration owns: a later registration under the same id has
          // already replaced it, and removing that would strand a live conversation's tasks.
          if (next.get(ownerId) === owner) {
            next.delete(ownerId);
          }
          return next;
        },
      );
    };
  }

  /**
   * Brings the conversation running a task on screen.
   * @param task The task to reveal.
   */
  public reveal(task: LiveAgentTask): void {
    this.owners().get(task.ownerId)?.reveal();
  }

  /**
   * Asks the provider to stop a running task.
   * @param task The task to stop.
   */
  public stop(task: LiveAgentTask): void {
    this.owners().get(task.ownerId)?.stop(task.taskId);
  }
}
