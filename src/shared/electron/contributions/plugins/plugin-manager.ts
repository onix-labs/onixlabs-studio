import { PluginActionResult, PluginState, PluginSummary } from '@shared/api/plugin-channels';
import { logger } from '../../logger';
import { PluginContext, PluginDescriptor } from './plugin-catalogue';
import { PluginStore } from './plugin-store';

/**
 * Owns the plugin model's first two layers: the catalogue of what is **available**, and the state of
 * what is **installed** on this machine. It answers "what is there", installs and uninstalls, and
 * nothing else — which plugin fills which slot is the third layer's business, decided by the user
 * among what this reports as installed.
 */
export class PluginManager {
  /**
   * Holds the available plugins, indexed by identifier.
   */
  private readonly descriptors: ReadonlyMap<string, PluginDescriptor>;

  /**
   * Holds the surface descriptors detect and install themselves through.
   */
  private readonly context: PluginContext;

  /**
   * Holds the record of what Studio installed.
   */
  private readonly store: PluginStore;

  /**
   * Holds the identifiers of plugins with an install or uninstall in flight, so the state they report
   * is `busy` and a second action cannot start on top of the first.
   */
  private readonly busy: Set<string> = new Set<string>();

  /**
   * Initializes a new instance of the {@link PluginManager} class.
   * @param descriptors The available plugins.
   * @param context The surface descriptors detect and install themselves through.
   * @param store The record of what Studio installed.
   */
  public constructor(
    descriptors: readonly PluginDescriptor[],
    context: PluginContext,
    store: PluginStore,
  ) {
    this.descriptors = new Map<string, PluginDescriptor>(
      descriptors.map((descriptor: PluginDescriptor): [string, PluginDescriptor] => [
        descriptor.id,
        descriptor,
      ]),
    );
    this.context = context;
    this.store = store;
  }

  /**
   * Lists every available plugin with its current state on this machine. Detection never installs, so
   * opening the Plugin Manager cannot start a download.
   * @returns Returns the summaries, in catalogue order.
   */
  public async list(): Promise<readonly PluginSummary[]> {
    const summaries: PluginSummary[] = [];
    for (const descriptor of this.descriptors.values()) {
      summaries.push(await this.summarise(descriptor));
    }
    return summaries;
  }

  /**
   * Installs a plugin, provisioning what it contributes and recording where the installation landed.
   * @param id The plugin identifier.
   * @returns Returns the outcome.
   */
  public async install(id: string): Promise<PluginActionResult> {
    const descriptor: PluginDescriptor | undefined = this.descriptors.get(id);
    if (descriptor === undefined) {
      return { success: false, state: 'unavailable', error: `Unknown plugin: ${id}` };
    }
    if (descriptor.supported?.(this.context) === false) {
      return {
        success: false,
        state: 'unavailable',
        error: `${descriptor.name} publishes no build for this platform.`,
      };
    }
    if (this.busy.has(id)) {
      return { success: false, state: 'busy', error: `${descriptor.name} is already installing.` };
    }
    this.busy.add(id);
    try {
      logger.info('PluginManager', `Installing ${id}`);
      const installedPath: string | null = await descriptor.install(this.context);
      if (installedPath === null) {
        logger.warn('PluginManager', `Install failed for ${id}`);
        return {
          success: false,
          state: 'available',
          error: descriptor.detail ?? `${descriptor.name} could not be installed.`,
        };
      }
      this.store.add({ id, version: descriptor.version ?? 'unknown', installedPath });
      logger.info('PluginManager', `Installed ${id} at ${installedPath}`);
      return { success: true, state: 'installed', error: null };
    } catch (error: unknown) {
      logger.error('PluginManager', `Install threw for ${id}`, error);
      return { success: false, state: 'available', error: `${descriptor.name} failed to install.` };
    } finally {
      this.busy.delete(id);
    }
  }

  /**
   * Uninstalls a plugin, removing what its installation put on disk.
   * @param id The plugin identifier.
   * @returns Returns the outcome.
   */
  public async uninstall(id: string): Promise<PluginActionResult> {
    const descriptor: PluginDescriptor | undefined = this.descriptors.get(id);
    if (descriptor === undefined) {
      return { success: false, state: 'unavailable', error: `Unknown plugin: ${id}` };
    }
    if (this.busy.has(id)) {
      return { success: false, state: 'busy', error: `${descriptor.name} is busy.` };
    }
    this.busy.add(id);
    try {
      logger.info('PluginManager', `Uninstalling ${id}`);
      await descriptor.uninstall(this.context);
      this.store.remove(id);
      return { success: true, state: 'available', error: null };
    } catch (error: unknown) {
      logger.error('PluginManager', `Uninstall threw for ${id}`, error);
      return {
        success: false,
        state: 'installed',
        error: `${descriptor.name} could not be removed.`,
      };
    } finally {
      this.busy.delete(id);
    }
  }

  /**
   * Builds a plugin's summary, resolving its current state.
   * @param descriptor The plugin to summarise.
   * @returns Returns the summary.
   */
  private async summarise(descriptor: PluginDescriptor): Promise<PluginSummary> {
    const state: PluginState = await this.stateOf(descriptor);
    return {
      id: descriptor.id,
      name: descriptor.name,
      description: descriptor.description,
      state,
      contributions: descriptor.contributions,
      version: descriptor.version,
      detail: state === 'installed' ? null : (descriptor.detail ?? null),
    };
  }

  /**
   * Resolves a plugin's state. A plugin is installed when its files are present or Studio recorded
   * installing it, and available otherwise — every plugin can be installed, so there is no third case
   * for something the user must go and fetch themselves.
   * @param descriptor The plugin to resolve.
   * @returns Returns the state.
   */
  private async stateOf(descriptor: PluginDescriptor): Promise<PluginState> {
    if (this.busy.has(descriptor.id)) {
      return 'busy';
    }
    if (descriptor.supported?.(this.context) === false) {
      return 'unavailable';
    }
    if (await descriptor.detect(this.context)) {
      return 'installed';
    }
    return this.store.isInstalled(descriptor.id) ? 'installed' : 'available';
  }
}
