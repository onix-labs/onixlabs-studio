import { shell } from 'electron';
import * as fs from 'node:fs/promises';
import {
  PluginActionResult,
  PluginChannel,
  PluginSummary,
  SideloadingState,
} from '@shared/api/plugin-channels';
import { LspProvisioner } from '../../lsp/lsp-provisioner';
import { ContributionContext, MainContribution } from '../main-contribution';
import { PluginContext, pluginCatalogue } from './plugin-catalogue';
import { pluginInstallEvents } from './plugin-install-events';
import { PluginManager } from './plugin-manager';
import { contributedPlugins, pluginIndex, pluginStore } from './contributed';
import { setSideloading, sideloadDirectory, sideloadingState } from './sideloaded';

/**
 * The part of the {@link PluginManager} the contribution drives.
 */
export type PluginActions = Pick<PluginManager, 'list' | 'install' | 'uninstall' | 'onChanged'>;

/**
 * What the contribution asks of the machine. A seam because listing plugins probes the machine for
 * every server in the catalogue, refreshing the index goes to the network and the folder lives in the
 * user's own data, none of which a spec may touch.
 */
export interface PluginsHost {
  /**
   * Builds the manager over the catalogue and the install store.
   * @returns Returns the manager.
   */
  createManager(): PluginActions;

  /**
   * Fetches the published index.
   * @returns Returns true when a newer index was cached.
   */
  refreshIndex(): Promise<boolean>;

  /**
   * Gets the revision of the index in force this launch.
   * @returns Returns the revision.
   */
  indexRevision(): number;

  /**
   * Gets the sideloading switch.
   * @returns Returns its state.
   */
  sideloadingState(): SideloadingState;

  /**
   * Persists the sideloading switch.
   * @param value The value the renderer sent.
   * @returns Returns the resulting state.
   */
  setSideloading(value: unknown): SideloadingState;

  /**
   * Gets main's own sideload folder.
   * @returns Returns the folder.
   */
  sideloadDirectory(): string;

  /**
   * Opens a folder in the file system.
   * @param directory The folder.
   * @returns Returns the error text, empty on success.
   */
  openPath(directory: string): Promise<string>;

  /**
   * Counts the catalogue, for the log.
   * @returns Returns the first-party and contributed plugin counts, in words.
   */
  describeCatalogue(): string;
}

/**
 * The machine itself.
 */
const MACHINE: PluginsHost = {
  createManager: (): PluginActions => {
    const pluginContext: PluginContext = { provisioner: new LspProvisioner() };
    // First-party plugins plus whatever was contributed — dropped into the sideload directory, or
    // offered by the curated index. A manifest is not a special case: it becomes a catalogue entry
    // and installs down the same path as everything else.
    //
    // The store comes from `contributed.ts` rather than being constructed here, because the resolution
    // path reads the installed version from it to decide which version to run (#456). Two instances
    // over one file would let the manager and the registries disagree about what is installed.
    //
    // The events are shared for the same reason: the hosts that must stop a replaced or removed plugin
    // are wired in `main.ts`, out of this contribution's reach (#881).
    return new PluginManager(
      [...pluginCatalogue(), ...contributedPlugins()],
      pluginContext,
      pluginStore(),
      pluginInstallEvents(),
    );
  },
  refreshIndex: (): Promise<boolean> => pluginIndex().refresh(),
  indexRevision: (): number => pluginIndex().revision(),
  sideloadingState,
  setSideloading,
  sideloadDirectory,
  openPath: (directory: string): Promise<string> => shell.openPath(directory),
  describeCatalogue: (): string =>
    `${pluginCatalogue().length} first-party, ${contributedPlugins().length} contributed`,
};

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
  private manager: PluginActions | null = null;

  /**
   * Initializes a new instance of the {@link PluginsContribution} class.
   * @param host What the contribution asks of the machine.
   */
  public constructor(private readonly host: PluginsHost = MACHINE) {}

  /**
   * Wires the plugin IPC handlers.
   * @param context The surface the contribution reaches the application through.
   */
  public activate(context: ContributionContext): void {
    this.manager = this.host.createManager();
    // Every state change — an action starting as well as finishing — pushes the refreshed list, so a
    // view shows a plugin as busy for as long as its install runs rather than only learning it is
    // installed once the download is over.
    this.manager.onChanged((): void => {
      void this.list().then((plugins: readonly PluginSummary[]): void =>
        context.send(PluginChannel.Changed, plugins),
      );
    });
    context.handle(PluginChannel.List, (): Promise<readonly PluginSummary[]> => this.list());
    context.handle(
      PluginChannel.Install,
      (_event: unknown, id: unknown): Promise<PluginActionResult> => this.act(id, true),
    );
    context.handle(
      PluginChannel.Uninstall,
      (_event: unknown, id: unknown): Promise<PluginActionResult> => this.act(id, false),
    );
    // The revision in force this launch, not the one on disk: a fetched index takes effect at the next
    // start, so this is what the running build's catalogue actually is — which is what a bug report needs.
    context.handle(PluginChannel.CatalogueRevision, (): Promise<number> =>
      Promise.resolve(this.host.indexRevision()),
    );
    // The sideloading switch (#979). Read at launch, before any plugin resolved, so a change is only
    // persisted here and applies from the next launch; the state reports both so Settings can say so.
    context.handle(PluginChannel.GetSideloading, (): Promise<SideloadingState> =>
      Promise.resolve(this.host.sideloadingState()),
    );
    context.handle(
      PluginChannel.SetSideloading,
      (_event: unknown, value: unknown): Promise<SideloadingState> =>
        Promise.resolve(this.host.setSideloading(value)),
    );
    // Opens main's own folder, never one the renderer names; made first, so the button works before
    // anything was ever sideloaded.
    context.handle(PluginChannel.OpenFolder, async (): Promise<string> => {
      const directory: string = this.host.sideloadDirectory();
      await fs.mkdir(directory, { recursive: true });
      return this.host.openPath(directory);
    });
    context.log.info(`Plugin catalogue ready (${this.host.describeCatalogue()})`);
    this.refreshIndex(context);
  }

  /**
   * Fetches the published index in the background, so a slow or unreachable one never delays start-up
   * and a failure is a log line rather than anything the user has to deal with. What it retrieves takes
   * effect on the next launch.
   * @param context The contribution context, used to log the outcome.
   */
  private refreshIndex(context: ContributionContext): void {
    void this.host.refreshIndex().then((updated: boolean): void => {
      if (updated) {
        context.log.info('A newer plugin index was fetched; it takes effect on the next launch');
      }
    });
  }

  /**
   * Lists the plugins with their state, degrading to an empty list when the manager is absent.
   * @returns Returns the summaries.
   */
  private list(): Promise<readonly PluginSummary[]> {
    return this.manager?.list() ?? Promise.resolve([]);
  }

  /**
   * Runs an install or uninstall for a plugin named by the renderer. The refreshed list reaches every
   * open view through the manager's change listener, as the action starts and again as it ends, so
   * nothing is pushed here.
   * @param id The plugin identifier from the renderer.
   * @param installing True to install, false to uninstall.
   * @returns Returns the outcome.
   */
  private act(id: unknown, installing: boolean): Promise<PluginActionResult> {
    if (typeof id !== 'string' || this.manager === null) {
      return Promise.resolve({ success: false, state: 'unavailable', error: 'Unknown plugin.' });
    }
    return installing ? this.manager.install(id) : this.manager.uninstall(id);
  }
}

/**
 * The singleton plugins contribution appended to the `mainContributions` manifest.
 */
export const pluginsContribution: MainContribution = new PluginsContribution();
