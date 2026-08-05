import { computed, DestroyRef, inject, Signal } from '@angular/core';
import type { AgentSurface } from '@shared/api/ai-types';
import type { RunConfiguration } from '@shared/api/studio';
import { Agent } from '@shared/angular/services/agent/agent';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import { AgentHosts, HostRunLauncher } from '@shared/angular/services/agent-hosts/agent-hosts';
import { AgentRequests } from '@shared/angular/services/agent-requests/agent-requests';
import { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';

/**
 * A deferred agent-host registration created in an injection context but completed once the owning
 * tab's id is known.
 */
export interface AgentHostRegistrar {
  /**
   * Registers the tab's live agent with the app-wide requests and hosts registries, so it appears in
   * Mission Control and the requests inbox for the tab's whole lifetime — not only while its chat
   * panel happens to be mounted. Call once from the view's `ngOnInit`, when the tab id is available.
   * @param tabId The owning tab's identifier.
   */
  register(tabId: string): void;
}

/**
 * Registers an IDE view's agent as a live host up front, independent of whether its docked chat panel
 * is mounted. IDE views (the workspace and repository tabs) provide one {@link Agent} for the tab's
 * whole life, but their agent panel is a dock tool that is torn down when another tool activates —
 * so registration cannot be left to the panel's chat, or the tab would drop out of Mission Control
 * whenever its agent panel is not the active tool. Because a live agent maps to exactly one host, the
 * dock chat's own registration is deduplicated against this one (see {@link AgentHosts.register}).
 *
 * Injects its dependencies in the calling injection context (a component field initializer); the
 * caller finalises registration from `ngOnInit` via {@link AgentHostRegistrar.register}, once the
 * required tab-id input is readable.
 * @param options The host's active-state signal, tool surface, and optional branch resolver.
 * @returns Returns a registrar to finalise once the tab id is known.
 */
export function createAgentHostRegistrar(options: {
  readonly isActive: Signal<boolean>;
  readonly surface: AgentSurface;
  /**
   * Resolves the branch the view's project is on (null when it is not a repository, or its head is
   * detached), or undefined for a host with no project behind it. Read lazily on every evaluation —
   * a view passes a closure over its own git state, which is not yet constructed when the registrar
   * is created in a field initializer.
   */
  readonly branch?: () => string | null;
  /**
   * Provides the host's ability to Run its workspace's default configuration, or undefined for a view
   * with no workspace behind it. Both members are read lazily, for the same field-initializer reason
   * as {@link branch}: the workspace's run-configuration reader and build runner are constructed after
   * the registrar. `defaultConfiguration` is wrapped in a reactive computed at registration.
   */
  readonly run?: {
    readonly defaultConfiguration: () => RunConfiguration | null;
    readonly starting: () => boolean;
    readonly running: () => boolean;
    readonly run: () => void;
    readonly stop: () => void;
  };
}): AgentHostRegistrar {
  const agent: Agent = inject(Agent);
  const conversation: AgentConversation = inject(AgentConversation);
  const hosts: AgentHosts = inject(AgentHosts);
  const requests: AgentRequests = inject(AgentRequests);
  const tabs: Tabs = inject(Tabs);
  const destroyRef: DestroyRef = inject(DestroyRef);
  const resolveBranch: (() => string | null) | undefined = options.branch;
  const runOptions:
    | {
        defaultConfiguration: () => RunConfiguration | null;
        starting: () => boolean;
        running: () => boolean;
        run: () => void;
        stop: () => void;
      }
    | undefined = options.run;

  return {
    register(tabId: string): void {
      const label: Signal<string> = computed(
        (): string => tabs.tabs().find((tab: Tab): boolean => tab.id === tabId)?.title ?? 'Agent',
      );
      const branch: Signal<string | null> | undefined =
        resolveBranch === undefined ? undefined : computed((): string | null => resolveBranch());
      const run: HostRunLauncher | undefined =
        runOptions === undefined
          ? undefined
          : {
              defaultConfiguration: computed(
                (): RunConfiguration | null => runOptions.defaultConfiguration(),
              ),
              starting: computed((): boolean => runOptions.starting()),
              running: computed((): boolean => runOptions.running()),
              run: (): void => runOptions.run(),
              stop: (): void => runOptions.stop(),
            };
      destroyRef.onDestroy(
        requests.register({
          agent,
          tabId: (): string | null => tabId,
          label: (): string => label(),
        }),
      );
      destroyRef.onDestroy(
        hosts.register({
          tabId,
          label,
          branch,
          run,
          surface: options.surface,
          agent,
          conversation,
          isActive: options.isActive,
        }),
      );
    },
  };
}
