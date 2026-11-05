import { computed, inject, Service, Signal, signal, WritableSignal } from '@angular/core';
import type { AiEvent, AiProviderInfo } from '@shared/api/ai-types';
import { DELETE_RUN_CONFIGURATIONS, SAVE_RUN_CONFIGURATIONS } from '@shared/api/ai-types';
import { AiRuntime } from '@shared/angular/services/ai-runtime/ai-runtime';
import { Log } from '@shared/angular/services/log/log';
import { Settings } from '@shared/angular/services/settings/settings';
import { ActiveWorkspace } from '@shared/angular/services/workspace/active-workspace';

/**
 * Specifies how long a run may take, in milliseconds, before it is abandoned. Nobody is watching it,
 * so a run that has stalled must end by itself rather than leave the dialog's spinner turning.
 */
const RUN_TIMEOUT_MS: number = 5 * 60 * 1000;

/**
 * The prompt the agent is sent. The schema, the tool names, and the house rules live in the
 * system-prompt appendix the provider attaches, so this stays a task rather than a restatement of the
 * contract.
 */
const AUTO_PROMPT: string = [
  "Set up this workspace's run configurations. Nobody is available to answer questions, so work",
  'alone and do not ask any.',
  '',
  'Work it out from the project itself: read the manifests, scripts, project files, and any',
  'documentation, and check that what you name actually exists. Then author the configurations a',
  'developer here would genuinely press — the applications and services this project runs, with the',
  'arguments and working directories they need — and, where several are normally run together, a',
  'compound that starts them in parallel.',
  '',
  'Set `default: true` on exactly one configuration: the one a developer here would press most often,',
  'which is what a single press of Run starts.',
  '',
  'List the existing configurations first and amend them rather than duplicating. If the project has',
  'nothing meaningfully runnable, create nothing and say so.',
].join('\n');

/**
 * Describes how an Auto-Configure run ended.
 */
export type AutoConfigureOutcome =
  | { readonly status: 'completed' }
  | { readonly status: 'cancelled' }
  | { readonly status: 'failed'; readonly message: string };

/**
 * Sets up a workspace's run configurations with an agent of its own.
 *
 * The run is deliberately separate from the workspace's agent: it has its own session and process, so
 * it neither interrupts what that agent is doing nor adds to its conversation, and the session is
 * closed when the run ends. It runs unattended behind a modal, so it may use the run-configuration
 * tools and whatever needs no permission (reading the project); anything else it asks for is refused,
 * and a question is answered with silence rather than left waiting.
 */
@Service()
export class RunConfigurationAgent {
  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the agent runtime the run goes through.
   */
  private readonly runtime: AiRuntime = inject(AiRuntime);

  /**
   * Holds the settings naming the configured AI connections.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the active-workspace seam, naming the folder to configure.
   */
  private readonly activeWorkspace: ActiveWorkspace = inject(ActiveWorkspace);

  /**
   * Holds the run in progress, or null when there is none.
   */
  private readonly current: WritableSignal<{ readonly cancel: () => void } | null> = signal<{
    readonly cancel: () => void;
  } | null>(null);

  /**
   * Gets whether a run is in progress.
   */
  public readonly running: Signal<boolean> = computed((): boolean => this.current() !== null);

  /**
   * Starts an agent to set up the active workspace's run configurations, and waits for it to finish.
   * @returns Returns how the run ended.
   */
  public async configure(): Promise<AutoConfigureOutcome> {
    const root: string | null = this.activeWorkspace.rootPath();
    if (root === null) {
      return {
        status: 'failed',
        message: 'Open a workspace folder first: there is nowhere to save run configurations.',
      };
    }
    if (this.current() !== null) {
      return { status: 'failed', message: 'Auto-Configure is already running.' };
    }
    let abandoned: boolean = false;
    this.current.set({
      cancel: (): void => {
        abandoned = true;
      },
    });
    try {
      const provider: AiProviderInfo | undefined = await this.provider();
      if (abandoned) {
        return { status: 'cancelled' };
      }
      if (provider === undefined) {
        return {
          status: 'failed',
          message: 'No AI provider is available. Set one up in Settings, then try again.',
        };
      }
      return await this.run(provider, root);
    } finally {
      this.current.set(null);
    }
  }

  /**
   * Stops the run in progress, if there is one.
   */
  public cancel(): void {
    this.current()?.cancel();
  }

  /**
   * Finds the provider to run with: the active connection's when it can run, or else the first that
   * can.
   * @returns Returns the provider, or undefined when none is available.
   */
  private async provider(): Promise<AiProviderInfo | undefined> {
    const providers: readonly AiProviderInfo[] = await this.runtime.listProviders(
      this.settings.aiConnections(),
    );
    const available: readonly AiProviderInfo[] = providers.filter(
      (candidate: AiProviderInfo): boolean => candidate.available,
    );
    const active: string = this.settings.aiActiveConnectionId();
    return (
      available.find((candidate: AiProviderInfo): boolean => candidate.id === active) ??
      available[0]
    );
  }

  /**
   * Runs the agent until it finishes, fails, is cancelled or times out.
   * @param provider The provider to run through.
   * @param root The workspace to configure.
   * @returns Returns how the run ended.
   */
  private run(provider: AiProviderInfo, root: string): Promise<AutoConfigureOutcome> {
    return new Promise<AutoConfigureOutcome>(
      (resolve: (outcome: AutoConfigureOutcome) => void): void => {
        const session: string = `auto-configure-${crypto.randomUUID()}`;
        let dispose: () => void = (): void => undefined;
        const finish: (outcome: AutoConfigureOutcome) => void = (
          outcome: AutoConfigureOutcome,
        ): void => {
          clearTimeout(timer);
          dispose();
          this.runtime.closeSession(session);
          this.log.info('workspace.run', `Auto-Configure ended: ${outcome.status}`);
          resolve(outcome);
        };
        // Listening starts before the run does, so not even its first event can be missed.
        let requestId: string = '';
        dispose = this.runtime.onEvent((event: AiEvent): void => {
          if (event.requestId === requestId) {
            this.onEvent(event, finish);
          }
        });
        requestId = this.runtime.run(provider.id, AUTO_PROMPT, {
          agentSessionId: session,
          workspaceRoot: root,
          surface: 'workspace',
          mode: 'agent',
          permissionPosture: 'prompt',
        });
        this.log.info('workspace.run', `Auto-Configure started on '${provider.id}'`);
        const timer: ReturnType<typeof setTimeout> = setTimeout((): void => {
          this.runtime.abort(requestId);
          finish({ status: 'failed', message: 'The agent took too long, so it was stopped.' });
        }, RUN_TIMEOUT_MS);
        this.current.set({
          cancel: (): void => {
            this.runtime.abort(requestId);
            finish({ status: 'cancelled' });
          },
        });
      },
    );
  }

  /**
   * Handles one event of the run.
   * @param event The event.
   * @param finish Ends the run with an outcome.
   */
  private onEvent(event: AiEvent, finish: (outcome: AutoConfigureOutcome) => void): void {
    switch (event.kind) {
      case 'permission':
        this.runtime.respondPermission(event.permissionId, this.mayUse(event.name));
        return;
      case 'input-request':
        this.runtime.respondInput(event.inputId, null);
        return;
      case 'status':
        if (event.state !== 'started') {
          finish(
            event.state === 'completed'
              ? { status: 'completed' }
              : { status: 'failed', message: 'The agent could not finish. Please try again.' },
          );
        }
        return;
      default:
        return;
    }
  }

  /**
   * Determines whether an unattended run may use a tool that asks for permission.
   * @param tool The tool's name, which a harness may qualify (`mcp__studio__…`).
   * @returns Returns true for the run-configuration tools, and false for anything else.
   */
  private mayUse(tool: string): boolean {
    return tool.endsWith(SAVE_RUN_CONFIGURATIONS) || tool.endsWith(DELETE_RUN_CONFIGURATIONS);
  }
}
