import { computed, InjectionToken, Service, signal, Signal, WritableSignal } from '@angular/core';
import type { AgentSurface } from '@shared/api/ai-types';
import type { Agent } from '@shared/angular/services/agent/agent';
import type { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';

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
  private readonly hostList: WritableSignal<readonly AgentHost[]> = signal<readonly AgentHost[]>([]);

  /**
   * Tracks the counter that assigns each registration a unique identity.
   */
  private sequence: number = 0;

  /**
   * Gets the live agent hosts, in registration order.
   */
  public readonly hosts: Signal<readonly AgentHost[]> = this.hostList.asReadonly();

  /**
   * Gets the number of live hosts whose agent is currently running.
   */
  public readonly runningCount: Signal<number> = computed(
    (): number => this.hostList().filter((host: AgentHost): boolean => host.agent.isRunning()).length,
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
    this.hostList.update((current: readonly AgentHost[]): readonly AgentHost[] => [...current, full]);
    return (): void => {
      this.hostList.update((current: readonly AgentHost[]): readonly AgentHost[] =>
        current.filter((existing: AgentHost): boolean => existing !== full),
      );
    };
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
