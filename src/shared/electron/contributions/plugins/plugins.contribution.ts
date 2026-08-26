import { app } from 'electron';
import * as path from 'node:path';
import { PluginActionResult, PluginChannel, PluginSummary } from '@shared/api/plugin-channels';
import { DebugProvisioner } from '../../debug/debug-provisioner';
import { LspProvisioner } from '../../lsp/lsp-provisioner';
import { ContributionContext, MainContribution } from '../main-contribution';
import { PluginContext, pluginCatalogue } from './plugin-catalogue';
import { PluginManager } from './plugin-manager';
import { PluginStore } from './plugin-store';

/**
 * The Plugin Manager's backend: the catalogue of available plugins, what is installed on this machine,
 * and installing and removing them.
 *
 * Arrives as a {@link MainContribution} (#388) rather than a manager wired into `main.ts`, so adding it
 * costs one line in the contributions manifest. That is deliberate: the plugin system's own backend
 * being a contribution is the strongest available statement that the contribution seam is the way
 * features reach the main process.
 */
export class PluginsContribution implements MainContribution {
  /**
   * Gets the stable identifier for the contribution, and its IPC channel namespace.
   */
  public readonly id: string = 'plugins';

  /**
   * Holds the manager, created on activation once the user-data directory is known.
   */
  private manager: PluginManager | null = null;

  /**
   * Wires the plugin IPC handlers.
   * @param context The surface the contribution reaches the application through.
   */
  public activate(context: ContributionContext): void {
    const userData: string = app.getPath('userData');
    const pluginContext: PluginContext = {
      provisioner: new LspProvisioner(),
      // The same install root the debug adapter registry provisions into, so what the Plugin Manager
      // reports installed is exactly what a debug session would find.
      debugProvisioner: new DebugProvisioner(
        new Map<string, string>(),
        path.join(userData, 'debug-adapters'),
      ),
    };
    this.manager = new PluginManager(pluginCatalogue(), pluginContext, new PluginStore(userData));
    context.handle(PluginChannel.List, (): Promise<readonly PluginSummary[]> => this.list());
    context.handle(
      PluginChannel.Install,
      (_event: unknown, id: unknown): Promise<PluginActionResult> => this.act(id, true, context),
    );
    context.handle(
      PluginChannel.Uninstall,
      (_event: unknown, id: unknown): Promise<PluginActionResult> => this.act(id, false, context),
    );
    context.log.info(`Plugin catalogue ready (${pluginCatalogue().length} plugins)`);
  }

  /**
   * Lists the plugins with their state, degrading to an empty list when the manager is absent.
   * @returns Returns the summaries.
   */
  private list(): Promise<readonly PluginSummary[]> {
    return this.manager?.list() ?? Promise.resolve([]);
  }

  /**
   * Runs an install or uninstall for a plugin named by the renderer, and pushes the refreshed list so
   * every open view reflects the change without polling.
   * @param id The plugin identifier from the renderer.
   * @param installing True to install, false to uninstall.
   * @param context The contribution context, used to push the change.
   * @returns Returns the outcome.
   */
  private async act(
    id: unknown,
    installing: boolean,
    context: ContributionContext,
  ): Promise<PluginActionResult> {
    if (typeof id !== 'string' || this.manager === null) {
      return { success: false, state: 'unavailable', error: 'Unknown plugin.' };
    }
    const result: PluginActionResult = installing
      ? await this.manager.install(id)
      : await this.manager.uninstall(id);
    context.send(PluginChannel.Changed, await this.list());
    return result;
  }
}

/**
 * The singleton plugins contribution appended to the `mainContributions` manifest.
 */
export const pluginsContribution: MainContribution = new PluginsContribution();
