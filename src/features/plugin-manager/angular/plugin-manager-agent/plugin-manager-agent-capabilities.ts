import { DestroyRef, inject, Service } from '@angular/core';
import {
  type AiBridgeScope,
  INSTALL_PLUGIN,
  LIST_PLUGINS,
  READ_WORKSPACE_LANGUAGES,
  UNINSTALL_PLUGIN,
} from '@shared/api/ai-types';
import type { Bridge } from '@shared/api/bridge';
import type { PluginContribution, PluginSummary } from '@shared/api/plugin-channels';
import { ProjectChannel } from '@shared/api/project-channels';
import type { ProjectModel } from '@shared/api/project-system';
import { canUpdate } from '@shared/angular/components/plugin-action/plugin-action-rules';
import { AiRuntime } from '@shared/angular/services/ai-runtime/ai-runtime';
import { Log } from '@shared/angular/services/log/log';
import { Plugins } from '@shared/angular/services/plugins/plugins';
import { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';

/**
 * The editor languages each ecosystem implies (#968): the ids the language-server and debugger
 * plugins declare they serve, so a workspace's ecosystem can be matched against them.
 */
export const ECOSYSTEM_LANGUAGES: Readonly<Record<string, readonly string[]>> = {
  dotnet: ['csharp', 'fsharp', 'vb'],
  jvm: ['java', 'kotlin', 'scala'],
  python: ['python'],
  cpp: ['c', 'cpp'],
  rust: ['rust'],
  go: ['go'],
  node: ['javascript', 'typescript'],
};

/**
 * An answer to the agent: the run is not the Plugin Manager's, a refusal, or a result.
 */
type Answer =
  | { readonly available: false }
  | { readonly available: true; readonly error: string }
  | ({ readonly available: true } & Record<string, unknown>);

/**
 * Describes what a plugin contributes, for the model: each slot, and the languages or formats it is
 * keyed by.
 * @param contribution The contribution.
 * @returns Returns the description.
 */
function describeContribution(contribution: PluginContribution): Record<string, unknown> {
  return {
    slot: contribution.slot,
    ...('languages' in contribution ? { languages: contribution.languages } : {}),
    ...('formats' in contribution ? { formats: contribution.formats } : {}),
  };
}

/**
 * The Plugin Manager agent's capabilities (#968): the plugins, the user's open workspaces, and
 * installing and uninstalling through the same {@link Plugins} service the view's buttons use — so an
 * install raises the plugin's consent window, and declining installs nothing.
 *
 * Provided by the Plugin Manager view, so they exist only while it is open, and each answers only a
 * run on the `plugins` surface.
 */
@Service()
export class PluginManagerAgentCapabilities {
  /**
   * Holds the plugin service.
   */
  private readonly plugins: Plugins = inject(Plugins);

  /**
   * Holds the open tabs, read for the workspaces.
   */
  private readonly tabs: Tabs = inject(Tabs);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the IPC bridge, through which a workspace's project system is read.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Registers the capabilities, and releases them with the view.
   */
  public constructor() {
    const runtime: AiRuntime = inject(AiRuntime);
    const handlers: Readonly<Record<string, (input: unknown) => Answer | Promise<Answer>>> = {
      [LIST_PLUGINS]: (input: unknown): Answer => this.list(input),
      [READ_WORKSPACE_LANGUAGES]: (): Promise<Answer> => this.workspaces(),
      [INSTALL_PLUGIN]: (input: unknown): Promise<Answer> => this.install(input),
      [UNINSTALL_PLUGIN]: (input: unknown): Promise<Answer> => this.uninstall(input),
    };
    const releases: readonly (() => void)[] = Object.entries(handlers).map(
      ([name, handler]: [string, (input: unknown) => Answer | Promise<Answer>]): (() => void) =>
        runtime.registerCapability(
          name,
          (input: unknown, scope: AiBridgeScope): Answer | Promise<Answer> =>
            scope.surface === 'plugins' ? handler(input) : { available: false },
        ),
    );
    inject(DestroyRef).onDestroy((): void => {
      for (const release of releases) {
        release();
      }
    });
  }

  /**
   * Lists the plugins, filtered.
   * @param input The request.
   * @returns Returns the plugins.
   */
  private list(input: unknown): Answer {
    const filter: unknown =
      input !== null && typeof input === 'object'
        ? (input as Record<string, unknown>)['filter']
        : undefined;
    const shown: readonly PluginSummary[] = this.plugins
      .plugins()
      .filter((plugin: PluginSummary): boolean => {
        switch (filter) {
          case 'installed':
            return plugin.installedVersion !== null;
          case 'available':
            return plugin.state === 'available';
          case 'updates':
            return canUpdate(plugin);
          default:
            return true;
        }
      });
    return {
      available: true,
      result: shown.map((plugin: PluginSummary) => ({
        id: plugin.id,
        name: plugin.name,
        description: plugin.description,
        state: plugin.state,
        version: plugin.version,
        installedVersion: plugin.installedVersion,
        updateWaiting: canUpdate(plugin),
        contributes: plugin.contributions.map(describeContribution),
      })),
    };
  }

  /**
   * Reports each open workspace's ecosystem and the languages it implies.
   * @returns Returns the workspaces.
   */
  private async workspaces(): Promise<Answer> {
    const roots: readonly string[] = [
      ...new Set<string>(
        this.tabs
          .tabs()
          .filter((tab: Tab): boolean => tab.type === 'directory' && tab.resourceKey !== undefined)
          .map((tab: Tab): string => tab.resourceKey!),
      ),
    ];
    const found: Record<string, unknown>[] = await Promise.all(
      roots.map(async (root: string): Promise<Record<string, unknown>> => {
        const model: ProjectModel | null =
          (await this.bridge?.invoke<ProjectModel | null>(ProjectChannel.ModelLoad, root)) ?? null;
        const ecosystem: string | null = model?.kind ?? null;
        return {
          folder: root,
          ecosystem,
          languages: ecosystem === null ? [] : (ECOSYSTEM_LANGUAGES[ecosystem] ?? []),
        };
      }),
    );
    return {
      available: true,
      result: found.length === 0 ? { note: 'No workspaces are open.' } : found,
    };
  }

  /**
   * Installs or updates a plugin through its consent window, and reports what happened: installed,
   * declined, or failed and why.
   * @param input The request.
   * @returns Returns the outcome.
   */
  private async install(input: unknown): Promise<Answer> {
    const id: string = this.idOf(input);
    const before: PluginSummary | undefined = this.find(id);
    if (before === undefined) {
      return { available: true, error: `There is no plugin with the id "${id}".` };
    }
    if (before.state === 'unavailable') {
      return { available: true, error: `${before.name} publishes no build for this machine.` };
    }
    if (before.installedVersion !== null && !canUpdate(before)) {
      return { available: true, error: `${before.name} is installed and up to date.` };
    }
    const outcome: 'installed' | 'declined' | 'failed' = await this.plugins.installWithConsent(id);
    if (outcome === 'installed') {
      this.log.info('pluginManager.agent', `Agent installed '${id}' ${before.version}`);
      return { available: true, outcome, version: before.version };
    }
    return outcome === 'failed'
      ? { available: true, outcome, reason: this.plugins.error() ?? 'the install did not finish' }
      : { available: true, outcome };
  }

  /**
   * Uninstalls a plugin.
   * @param input The request.
   * @returns Returns the outcome.
   */
  private async uninstall(input: unknown): Promise<Answer> {
    const id: string = this.idOf(input);
    const plugin: PluginSummary | undefined = this.find(id);
    if (plugin === undefined || plugin.installedVersion === null) {
      return { available: true, error: `"${id}" is not installed.` };
    }
    await this.plugins.uninstall(id);
    const error: string | null = this.plugins.error();
    if (error !== null) {
      return { available: true, error };
    }
    this.log.info('pluginManager.agent', `Agent uninstalled '${id}'`);
    return { available: true, uninstalled: true };
  }

  /**
   * Reads the plugin id out of a request.
   * @param input The request.
   * @returns Returns the id, or empty.
   */
  private idOf(input: unknown): string {
    const id: unknown =
      input !== null && typeof input === 'object' ? (input as Record<string, unknown>)['id'] : '';
    return typeof id === 'string' ? id.trim() : '';
  }

  /**
   * Finds a plugin by id.
   * @param id The id.
   * @returns Returns the plugin, or undefined.
   */
  private find(id: string): PluginSummary | undefined {
    return this.plugins.plugins().find((plugin: PluginSummary): boolean => plugin.id === id);
  }
}
