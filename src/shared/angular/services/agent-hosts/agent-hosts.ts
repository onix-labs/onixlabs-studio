import { computed, InjectionToken, Service, signal, Signal, WritableSignal } from '@angular/core';
import type { AgentSurface } from '@shared/api/ai-types';
import type { RunConfiguration } from '@shared/api/studio';
import type { Agent } from '@shared/angular/services/agent/agent';
import type { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';

/**
 * A host's ability to single-press Run its workspace's default configuration, carried by a
 * workspace-backed host so a surface such as Mission Control can offer a Run button without knowing
 * anything about run configurations. Absent on a host with no workspace behind it (a file, terminal,
 * or repository agent), which is what tells such a surface not to show the button at all.
 */
export interface HostRunLauncher {
  /**
   * Gets the workspace's default run configuration, or null when none is designated — read reactively
   * so a Run button appears and disappears as the default is set or cleared.
   */
  readonly defaultConfiguration: Signal<RunConfiguration | null>;

  /**
   * Gets whether the default configuration is launching: requested but its process not yet started.
   * A Run button shows a spinner and disables itself for this window (which may be brief, or long for
   * a slow toolchain), so a press gives immediate feedback rather than looking inert.
   */
  readonly starting: Signal<boolean>;

  /**
   * Gets whether the default configuration is running: its process has started and not yet exited. A
   * Run button becomes a Stop button while this holds.
   */
  readonly running: Signal<boolean>;

  /**
   * Runs the workspace's default configuration in its own workspace (not the active one), a no-op when
   * there is no default to run.
   */
  run(): void;

  /**
   * Stops the default configuration's in-flight run (or, for a compound default, each of its members),
   * a no-op when it is not running.
   */
  stop(): void;
}

/**
 * A live agent conversation host, registered app-wide so surfaces such as Mission Control can mirror
 * it. It carries the host's live {@link Agent} session and {@link AgentConversation} — the actual
 * instances, not copies — so a mirror drives the same transcript and run as the origin. `tabId`/`label`
 * attribute it; `surface` selects the tool set a run acts on.
 */
export interface AgentHost {
  /**
   * Gets the registration's stable identity (unique per live host, assigned on registration).
   */
  readonly id: string;

  /**
   * Gets the identifier of the hosting tab, or null when the host has no owning tab (the workspace and
   * repository agent panels).
   */
  readonly tabId: string | null;

  /**
   * Gets the display label the host is attributed to (the tab title, or a panel name), read reactively
   * so a renamed tab updates.
   */
  readonly label: Signal<string>;

  /**
   * Gets the source-control branch the host's project is on, read reactively so a checkout updates,
   * or undefined for a host that is not backed by a project (a file, terminal, or binary agent). A
   * project-backed host whose folder is not a repository — or whose head is detached — reads null.
   * Surfaced beside the host's title in Mission Control, so several columns over the same repository
   * are told apart by the branch each is working on.
   */
  readonly branch?: Signal<string | null>;

  /**
   * Gets the host's ability to Run its workspace's default configuration, or undefined for a host with
   * no workspace behind it. Present only on workspace-backed hosts, so a surface offers a Run button
   * exactly where it makes sense.
   */
  readonly run?: HostRunLauncher;

  /**
   * Gets the tool surface the host's runs act on.
   */
  readonly surface: AgentSurface;

  /**
   * Gets the host's live agent session.
   */
  readonly agent: Agent;

  /**
   * Gets the host's live conversation.
   */
  readonly conversation: AgentConversation;

  /**
   * Gets a value indicating whether the host's own surface is currently active.
   */
  readonly isActive: Signal<boolean>;
}

/**
 * Injection token that carries the {@link AgentHost} a Mission Control tile mirrors, provided into the
 * tile's injector alongside the host's live {@link Agent} and {@link AgentConversation}.
 */
export const AGENT_HOST: InjectionToken<AgentHost> = new InjectionToken<AgentHost>('AGENT_HOST');

/**
 * The app-wide registry of live agent conversation hosts. Every mounted agent conversation registers
 * its live session here (once, from its {@link import('../../components/agent-chat/agent-chat').AgentChat}
 * leaf), and a mirror — such as a Mission Control tile — renders the shared agent UI against the same
 * {@link Agent}/{@link AgentConversation} instances, so both views stream the same run and answer the
 * same requests. Entries appear when a host mounts and vanish when it is destroyed.
 */
@Service()
export class AgentHosts {
  /**
   * Holds the registered live hosts.
   */
  private readonly hostList: WritableSignal<readonly AgentHost[]> = signal<readonly AgentHost[]>(
    [],
  );

  /**
   * Tracks the counter that assigns each registration a unique identity.
   */
  private sequence: number = 0;

  /**
   * Gets the live agent hosts, in display order: registration order until a surface reorders them via
   * {@link reorder}.
   */
  public readonly hosts: Signal<readonly AgentHost[]> = this.hostList.asReadonly();

  /**
   * Gets the number of live hosts whose agent is currently running.
   */
  public readonly runningCount: Signal<number> = computed(
    (): number =>
      this.hostList().filter((host: AgentHost): boolean => host.agent.isRunning()).length,
  );

  /**
   * Registers a live agent host. The returned function unregisters it when the host is destroyed.
   *
   * A live agent maps to exactly one host: if the same {@link Agent} instance is already registered
   * (an IDE view registers its agent up front, and the same agent's docked chat would otherwise
   * register it again when its panel mounts), the duplicate is dropped and its unregister is a no-op,
   * so the up-front registration keeps ownership.
   * @param host The host to register, without its assigned identity.
   * @returns Returns a function that unregisters the host.
   */
  public register(host: Omit<AgentHost, 'id'>): () => void {
    if (this.hostList().some((existing: AgentHost): boolean => existing.agent === host.agent)) {
      return (): void => {
        // Already registered by another surface onto the same agent; nothing to remove.
      };
    }
    this.sequence += 1;
    const full: AgentHost = { ...host, id: `agent-host-${this.sequence}` };
    this.hostList.update((current: readonly AgentHost[]): readonly AgentHost[] => [
      ...current,
      full,
    ]);
    return (): void => {
      this.hostList.update((current: readonly AgentHost[]): readonly AgentHost[] =>
        current.filter((existing: AgentHost): boolean => existing !== full),
      );
    };
  }

  /**
   * Moves the host identified by {@link sourceId} to the position of the host identified by
   * {@link targetId}, preserving the order of the others. This is the single ordering source both the
   * Mission Control rail and its columns read from, so a drag-reorder in the rail reorders the columns
   * too. A no-op when either id is unknown or the two are the same.
   * @param sourceId The id of the host being moved.
   * @param targetId The id of the host whose position it should take.
   */
  public reorder(sourceId: string, targetId: string): void {
    if (sourceId === targetId) {
      return;
    }
    this.hostList.update((current: readonly AgentHost[]): readonly AgentHost[] => {
      const from: number = current.findIndex((host: AgentHost): boolean => host.id === sourceId);
      const to: number = current.findIndex((host: AgentHost): boolean => host.id === targetId);
      if (from < 0 || to < 0) {
        return current;
      }
      const next: AgentHost[] = [...current];
      const [moved]: AgentHost[] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  /**
   * Stops every running host.
   */
  public stopAll(): void {
    for (const host of this.hostList()) {
      if (host.agent.isRunning()) {
        host.agent.stop();
      }
    }
  }
}
