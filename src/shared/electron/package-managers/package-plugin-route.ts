import type {
  PackageManagerModel,
  PackageSearchOptions,
  PackageSearchResult,
  PackageSourceInfo,
} from '@shared/api/package-management';
import type { PackageManagerResponse } from '@shared/api/package-manager-protocol';
import { logger } from '../logger';
import { PackageManagerDescriptor } from './package-manager-descriptor';
import { PackageManagerHost } from './package-manager-host';

/**
 * Puts the Packages panel's three questions to the installed package-manager plugins (#909), declining
 * whatever they cannot answer so core's own npm and NuGet serve it instead. That fallback is what keeps
 * the panel working while the plugins are not released; #911 removes it along with core's copies.
 *
 * The panel draws one model for now, so the first plugin in priority order with something to say serves
 * the folder, and the same plugin answers its sources and searches. How several appear together is
 * #912's to decide.
 *
 * ⛔ A decline (`null`) is never a refusal to the user: it means core answers as it always has.
 */
export class PackagePluginRoute {
  /**
   * Holds the plugins' host.
   */
  private readonly host: PackageManagerHost;

  /**
   * Holds which plugin serves each folder, once one has.
   */
  private readonly serving: Map<string, string> = new Map<string, string>();

  /**
   * Initializes the route.
   * @param host The plugins' host.
   */
  public constructor(host: PackageManagerHost) {
    this.host = host;
  }

  /**
   * Loads a folder's model from the first plugin that can model it.
   * @param root The open workspace root.
   * @returns Returns the model, or null when no plugin serves the folder.
   */
  public async load(root: string): Promise<PackageManagerModel | null> {
    this.serving.delete(root);
    for (const plugin of await this.candidates(root)) {
      const response: PackageManagerResponse<'load'> = await this.host.request(
        plugin.id,
        root,
        'load',
        {},
      );
      if (response.ok && response.result !== null) {
        this.serving.set(root, plugin.id);
        return response.result;
      }
      if (!response.ok) {
        logger.warn('PackagePluginRoute', `${plugin.id} could not load: ${response.error}`);
      }
    }
    return null;
  }

  /**
   * Lists the sources of the plugin serving a folder.
   * @param root The open workspace root.
   * @returns Returns the sources, empty when that plugin cannot list any, or null to decline.
   */
  public async sources(root: string): Promise<readonly PackageSourceInfo[] | null> {
    const pluginId: string | null = await this.servingPlugin(root);
    if (pluginId === null) {
      return null;
    }
    const response: PackageManagerResponse<'sources'> = await this.host.request(
      pluginId,
      root,
      'sources',
      {},
    );
    if (response.ok) {
      return response.result.sources;
    }
    return this.declineUnlessUnsupported(response, root, []);
  }

  /**
   * Searches a source of the plugin serving a folder.
   * @param root The open workspace root.
   * @param source The source to search.
   * @param query The search text.
   * @param options The paging and prerelease options.
   * @returns Returns a page of results, or null to decline.
   */
  public async search(
    root: string,
    source: string,
    query: string,
    options: PackageSearchOptions,
  ): Promise<PackageSearchResult | null> {
    const pluginId: string | null = await this.servingPlugin(root);
    if (pluginId === null) {
      return null;
    }
    const response: PackageManagerResponse<'search'> = await this.host.request(
      pluginId,
      root,
      'search',
      { ...options, source, query },
    );
    if (response.ok) {
      return response.result;
    }
    return this.declineUnlessUnsupported(response, root, { items: [], total: 0, hasMore: false });
  }

  /**
   * Gets the plugins that may be asked about a folder, in priority order.
   * @param root The open workspace root.
   * @returns Returns the plugins, empty when the folder may not be asked about or none applies.
   */
  private async candidates(root: string): Promise<readonly PackageManagerDescriptor[]> {
    return this.host.accepts(root) ? this.host.pluginsFor(root) : [];
  }

  /**
   * Gets the plugin serving a folder: the one that loaded it, or the first that applies when the panel
   * asks about sources before a model has come back.
   * @param root The open workspace root.
   * @returns Returns the plugin, or null when no plugin serves the folder.
   */
  private async servingPlugin(root: string): Promise<string | null> {
    if (!this.host.accepts(root)) {
      return null;
    }
    return this.serving.get(root) ?? (await this.candidates(root))[0]?.id ?? null;
  }

  /**
   * Turns a failed request into what the panel is told. A plugin that simply cannot do this is an
   * answer; any other failure declines, and forgets the plugin, so core takes over.
   * @param response The failed response.
   * @param root The folder.
   * @param unsupported What to answer when the plugin does not support the request.
   * @returns Returns the answer, or null to decline.
   */
  private declineUnlessUnsupported<Answer>(
    response: { readonly error: string; readonly code?: string },
    root: string,
    unsupported: Answer,
  ): Answer | null {
    if (response.code === 'unsupported') {
      return unsupported;
    }
    logger.warn('PackagePluginRoute', `A plugin could not answer: ${response.error}`);
    this.serving.delete(root);
    return null;
  }
}
