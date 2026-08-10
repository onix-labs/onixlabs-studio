import { computed, inject, Service, Signal } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { AgentHost, AgentHosts } from '@shared/angular/services/agent-hosts/agent-hosts';
import {
  AgentRequestEntry,
  AgentRequests,
} from '@shared/angular/services/agent-requests/agent-requests';
import { ActiveWorkspace } from '@shared/angular/services/workspace/active-workspace';
import { Tabs } from '@shared/angular/services/tabs/tabs';

/**
 * The prompt the Auto button sends: the agent assesses the workspace and authors what is worth running,
 * with no further input from the user. The schema, the tool names, and the house rules live in the
 * system-prompt appendix the provider attaches (`RUN_CONFIGURATION_PROMPT_APPENDIX`), so this stays a
 * task rather than a restatement of the contract.
 */
const AUTO_PROMPT: string = [
  "Set up this workspace's run configurations.",
  '',
  'Work it out from the project itself: read the manifests, scripts, project files, and any',
  'documentation, and check that what you name actually exists. Then author the configurations a',
  'developer here would genuinely press — the applications and services this project runs, with the',
  'arguments and working directories they need — and, where several are normally run together, a',
  'compound that starts them in parallel.',
  '',
  'List the existing configurations first and amend them rather than duplicating. If the project has',
  'nothing meaningfully runnable, create nothing and say so.',
].join('\n');

/**
 * Dispatches run-configuration work to the **active workspace's own agent**, which authors the
 * configurations through its run-configuration tools.
 *
 * The Configure dialog lives at the application shell, above the tabs, so it cannot inject a workspace
 * tab's scoped `Agent`. It resolves the active tab's live agent host instead — the same
 * resolve-the-active-tab approach `Builds` and `StudioConfig` take — so the work runs in the agent the
 * user already has for that workspace: its transcript appears in the Agent panel and Mission Control,
 * its questions are answerable there, and it inherits the existing write confinement, per-tool policy,
 * and audit log rather than inventing a second, invisible agent.
 */
@Service()
export class RunConfigurationAgent {
  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the app-wide registry of live agent hosts, searched for the active tab's agent.
   */
  private readonly hosts: AgentHosts = inject(AgentHosts);

  /**
   * Holds the app-wide pending-request registry, so a dispatcher can surface the questions and
   * permission prompts its agent raises rather than leaving them unanswerable behind a modal.
   */
  private readonly requests: AgentRequests = inject(AgentRequests);

  /**
   * Holds the tab registry, used to resolve which tab is active.
   */
  private readonly tabs: Tabs = inject(Tabs);

  /**
   * Holds the active-workspace seam, used to check a folder is actually open to author for.
   */
  private readonly activeWorkspace: ActiveWorkspace = inject(ActiveWorkspace);

  /**
   * Gets the active tab's live agent host, or null when the active tab has none (so nothing can be
   * dispatched).
   */
  private readonly host: Signal<AgentHost | null> = computed((): AgentHost | null => {
    const activeTabId: string | undefined = this.tabs.activeTabId();
    if (activeTabId === undefined) {
      return null;
    }
    return (
      this.hosts.hosts().find((candidate: AgentHost): boolean => candidate.tabId === activeTabId) ??
      null
    );
  });

  /**
   * Gets whether a request can be dispatched: a workspace folder is open (there is somewhere to write)
   * and the active tab has a live agent to do the work.
   */
  public readonly canDispatch: Signal<boolean> = computed(
    (): boolean => this.activeWorkspace.rootPath() !== null && this.host() !== null,
  );

  /**
   * Gets why dispatch is unavailable, or null when it is available — so the dialog explains itself
   * rather than presenting a button that silently does nothing.
   */
  public readonly unavailableReason: Signal<string | null> = computed((): string | null => {
    if (this.activeWorkspace.rootPath() === null) {
      return 'Open a workspace folder first — there is nowhere to save run configurations.';
    }
    return this.host() === null ? 'This tab has no agent to do the work.' : null;
  });

  /**
   * Gets whether the active workspace's agent is currently running.
   */
  public readonly busy: Signal<boolean> = computed(
    (): boolean => this.host()?.agent.isRunning() ?? false,
  );

  /**
   * Gets the dispatched agent's pending requests — permission prompts, edit decisions, and questions.
   *
   * The Configure dialog is modal, so the agent panel behind it cannot be reached: without this, a run
   * that asks "Allow Bash?" would sit there forever with the dialog cheerfully reporting that the agent
   * is working. The dialog renders these inline (with the same card Mission Control uses), so the
   * agent's questions are answered where the user is looking.
   */
  public readonly pendingRequests: Signal<readonly AgentRequestEntry[]> = computed(
    (): readonly AgentRequestEntry[] => {
      const host: AgentHost | null = this.host();
      if (host === null) {
        return [];
      }
      return this.requests
        .entries()
        .filter((entry: AgentRequestEntry): boolean => entry.agent === host.agent);
    },
  );

  /**
   * Asks the agent to assess the workspace and author its run configurations, unattended.
   * @returns Returns true when the request was dispatched.
   */
  public dispatchAuto(): boolean {
    return this.dispatch(AUTO_PROMPT);
  }

  /**
   * Asks the agent to author run configurations from the user's own description of what they want to
   * run, leaving the agent to work out how.
   * @param request The user's description (for example, which scripts to run in parallel).
   * @returns Returns true when the request was dispatched.
   */
  public dispatchRequest(request: string): boolean {
    const trimmed: string = request.trim();
    if (trimmed.length === 0) {
      return false;
    }
    return this.dispatch(
      [
        "Set up this workspace's run configurations to satisfy this request:",
        '',
        trimmed,
        '',
        'Work out how to make that happen from the project itself, and check that whatever you name',
        'actually exists before you write it. List the existing configurations first and amend them',
        'rather than duplicating. If the request names several things to run together, author each one',
        'and a compound that starts them in parallel.',
      ].join('\n'),
    );
  }

  /**
   * Sends a prompt to the active tab's agent on its own surface, so the run behaves exactly as one the
   * user typed into that agent's composer.
   * @param prompt The prompt to send.
   * @returns Returns true when a host was available and the prompt was sent.
   */
  private dispatch(prompt: string): boolean {
    const host: AgentHost | null = this.host();
    if (host === null || this.activeWorkspace.rootPath() === null) {
      this.log.warn('workspace.run', 'Run-configuration agent dispatch skipped: no host or no folder');
      return false;
    }
    this.log.info('workspace.run', 'Run-configuration agent dispatched');
    host.agent.send(prompt, host.tabId ?? undefined, host.surface);
    return true;
  }
}
