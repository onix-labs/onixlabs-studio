import { ipcMain, IpcMainInvokeEvent } from 'electron';
import {
  PackageAnswer,
  PackageChannel,
  PackageManagerSummary,
  PackageRegistryToken,
  PackageTokenResult,
  PackageWorkspaceStatus,
} from '@shared/api/package-channels';
import type {
  PackageManagerModel,
  PackageSearchResult,
  PackageSourceInfo,
} from '@shared/api/package-management';
import type {
  PackageManagerOp,
  PackageManagerParams,
  PackageManagerResponse,
  PackageManagerResult,
} from '@shared/api/package-manager-protocol';
import type { RepositoryTrustDecision } from '@shared/api/source-control-channels';
import type { RepositoryTrustChoice } from '../repository-trust';
import { logger } from '../logger';
import { PackageManagerDescriptor } from './package-manager-descriptor';
import { PackageRegistryTokenStore } from './package-registry-token-store';

/**
 * The part of the package-manager host the channels ask.
 */
export interface PackageManagerChannelsHost {
  /**
   * Finds every contributed plugin a folder applies to, installed or not.
   * @param root The folder.
   * @returns Returns the plugins, highest priority first.
   */
  detect(root: unknown): Promise<readonly PackageManagerDescriptor[]>;

  /**
   * Gets a contributed plugin by id.
   * @param pluginId The plugin.
   * @returns Returns the descriptor, or undefined when there is none.
   */
  descriptor(pluginId: string): PackageManagerDescriptor | undefined;

  /**
   * Asks a plugin to perform an operation on a folder.
   * @param pluginId The plugin.
   * @param root The folder.
   * @param op The operation.
   * @param params Its parameters.
   * @returns Returns the plugin's answer, or the host's refusal.
   */
  request<Op extends PackageManagerOp>(
    pluginId: string,
    root: unknown,
    op: Op,
    params: PackageManagerParams<Op>,
  ): Promise<PackageManagerResponse<Op>>;
}

/**
 * The part of the open-workspace registry the channels check a root against.
 */
export interface PackageManagerChannelsRoots {
  /**
   * Determines whether a path is exactly an open workspace root.
   * @param target The path.
   * @returns Returns true when it is.
   */
  isRoot(target: string): boolean;
}

/**
 * The part of the trust store the channels read and write.
 */
export interface PackageManagerChannelsTrust {
  /**
   * Gets the decision in force for a folder.
   * @param target The folder.
   * @returns Returns the decision.
   */
  decisionFor(target: unknown): RepositoryTrustDecision;

  /**
   * Records a decision about a folder.
   * @param target The folder.
   * @param choice The decision.
   */
  decide(target: string, choice: RepositoryTrustChoice): void;
}

/**
 * Serves the Packages panel and Settings over the package-manager host (#911). Core has no package
 * manager of its own any more: every question names a plugin, and with none installed there is
 * nothing to answer but which plugin would.
 *
 * ⛔ The renderer is treated as hostile. A root must be exactly an open workspace root, a plugin must be
 * a contributed one, and the host behind this checks trust, capability and every command it is given.
 */
export class PackageManagerChannels {
  /**
   * Holds the host.
   */
  private readonly host: PackageManagerChannelsHost;

  /**
   * Holds the open workspace roots.
   */
  private readonly roots: PackageManagerChannelsRoots;

  /**
   * Holds the trust store, shared with version control so a folder is trusted once.
   */
  private readonly trust: PackageManagerChannelsTrust;

  /**
   * Holds the registry tokens saved in Studio.
   */
  private readonly tokens: PackageRegistryTokenStore;

  /**
   * Initializes a new instance of the {@link PackageManagerChannels} class.
   * @param host The package-manager host.
   * @param roots The open workspace roots.
   * @param trust The trust store.
   * @param tokens The registry tokens saved in Studio.
   */
  public constructor(
    host: PackageManagerChannelsHost,
    roots: PackageManagerChannelsRoots,
    trust: PackageManagerChannelsTrust,
    tokens: PackageRegistryTokenStore,
  ) {
    this.host = host;
    this.roots = roots;
    this.trust = trust;
    this.tokens = tokens;
  }

  /**
   * Registers the IPC handlers.
   */
  public register(): void {
    ipcMain.handle(
      PackageChannel.Managers,
      (_event: IpcMainInvokeEvent, root: unknown): Promise<PackageWorkspaceStatus> =>
        this.managers(root),
    );
    ipcMain.handle(
      PackageChannel.ModelLoad,
      (
        _event: IpcMainInvokeEvent,
        root: unknown,
        pluginId: unknown,
      ): Promise<PackageAnswer<PackageManagerModel | null>> => this.ask(root, pluginId, 'load', {}),
    );
    ipcMain.handle(
      PackageChannel.Sources,
      (
        _event: IpcMainInvokeEvent,
        root: unknown,
        pluginId: unknown,
      ): Promise<PackageAnswer<readonly PackageSourceInfo[]>> => this.sources(root, pluginId),
    );
    ipcMain.handle(
      PackageChannel.Search,
      (
        _event: IpcMainInvokeEvent,
        root: unknown,
        pluginId: unknown,
        source: unknown,
        query: unknown,
        options: unknown,
      ): Promise<PackageAnswer<PackageSearchResult>> =>
        this.search(root, pluginId, source, query, options),
    );
    ipcMain.handle(
      PackageChannel.TrustFolder,
      (_event: IpcMainInvokeEvent, root: unknown): RepositoryTrustDecision =>
        this.trustFolder(root),
    );
    ipcMain.handle(PackageChannel.Tokens, (): readonly PackageRegistryToken[] =>
      this.tokens.list(),
    );
    ipcMain.handle(
      PackageChannel.SaveToken,
      (
        _event: IpcMainInvokeEvent,
        pluginId: unknown,
        registry: unknown,
        token: unknown,
      ): PackageTokenResult => this.saveToken(pluginId, registry, token),
    );
    ipcMain.handle(
      PackageChannel.ClearToken,
      (_event: IpcMainInvokeEvent, pluginId: unknown, registry: unknown): PackageTokenResult =>
        this.clearToken(pluginId, registry),
    );
    logger.info('PackageManagerChannels', 'Registered package IPC handlers');
  }

  /**
   * Says which package managers apply to an open root, installed or not, and whether it is trusted.
   * Reading file names is all this does: no plugin runs, so it is answered for an untrusted folder too,
   * which is how the panel can say what trusting it, or installing a plugin, would show.
   * @param root The root, untrusted.
   * @returns Returns the status; empty for anything that is not an open root.
   */
  private async managers(root: unknown): Promise<PackageWorkspaceStatus> {
    if (!this.isOpenRoot(root)) {
      return { managers: [], trust: 'unknown' };
    }
    const found: readonly PackageManagerDescriptor[] = await this.host.detect(root);
    return {
      managers: found.map((descriptor: PackageManagerDescriptor): PackageManagerSummary => ({
        pluginId: descriptor.id,
        displayName: descriptor.displayName,
        ecosystem: descriptor.ecosystem,
        installed: descriptor.resolve().available,
        capabilities: descriptor.capabilities,
      })),
      trust: this.trust.decisionFor(root),
    };
  }

  /**
   * Lists a plugin's sources for an open root.
   * @param root The root, untrusted.
   * @param pluginId The plugin, untrusted.
   * @returns Returns the source names, or why there are none.
   */
  private async sources(
    root: unknown,
    pluginId: unknown,
  ): Promise<PackageAnswer<readonly PackageSourceInfo[]>> {
    const answer: PackageAnswer<{ readonly sources: readonly PackageSourceInfo[] }> =
      await this.ask(root, pluginId, 'sources', {});
    return answer.ok ? { ok: true, result: answer.result.sources } : answer;
  }

  /**
   * Searches one of a plugin's sources for an open root. The host bounds the page and drops what the
   * plugin cannot do.
   * @param root The root, untrusted.
   * @param pluginId The plugin, untrusted.
   * @param source The source, untrusted.
   * @param query The search text, untrusted.
   * @param options The paging and prerelease options, untrusted.
   * @returns Returns a page of results, or why there is none.
   */
  private search(
    root: unknown,
    pluginId: unknown,
    source: unknown,
    query: unknown,
    options: unknown,
  ): Promise<PackageAnswer<PackageSearchResult>> {
    if (typeof source !== 'string' || typeof query !== 'string') {
      return Promise.resolve({ ok: false, error: 'That is not a search.', code: 'refused' });
    }
    const record: Record<string, unknown> =
      typeof options === 'object' && options !== null ? (options as Record<string, unknown>) : {};
    return this.ask(root, pluginId, 'search', {
      source,
      query,
      skip: typeof record['skip'] === 'number' ? record['skip'] : 0,
      take: typeof record['take'] === 'number' ? record['take'] : 0,
      prerelease: record['prerelease'] === true,
    });
  }

  /**
   * Puts one question to a plugin about an open root.
   * @param root The root, untrusted.
   * @param pluginId The plugin, untrusted.
   * @param op The operation.
   * @param params Its parameters.
   * @returns Returns the plugin's answer, or why it was not asked.
   */
  private async ask<Op extends 'load' | 'sources' | 'search'>(
    root: unknown,
    pluginId: unknown,
    op: Op,
    params: PackageManagerParams<Op>,
  ): Promise<PackageAnswer<PackageManagerResult<Op>>> {
    if (!this.isOpenRoot(root)) {
      logger.warn('PackageManagerChannels', `Refused ${op} for a folder that is not open`);
      return { ok: false, error: 'That folder is not open.', code: 'refused' };
    }
    if (typeof pluginId !== 'string' || this.host.descriptor(pluginId) === undefined) {
      return { ok: false, error: 'No such package manager is installed.', code: 'refused' };
    }
    const response: PackageManagerResponse<Op> = await this.host.request(
      pluginId,
      root,
      op,
      params,
    );
    if (response.ok) {
      return { ok: true, result: response.result };
    }
    logger.debug('PackageManagerChannels', `${pluginId} did not answer ${op}: ${response.error}`);
    return { ok: false, error: response.error, code: response.code };
  }

  /**
   * Trusts an open root from the Packages panel, the one place a folder that is not a repository can
   * be trusted from. The decision is the same one version control reads.
   * @param root The root, untrusted.
   * @returns Returns the decision in force afterwards, `unknown` when the request was refused.
   */
  private trustFolder(root: unknown): RepositoryTrustDecision {
    if (!this.isOpenRoot(root)) {
      logger.warn('PackageManagerChannels', 'Refused to trust a folder that is not open');
      return 'unknown';
    }
    this.trust.decide(root, 'trusted');
    return this.trust.decisionFor(root);
  }

  /**
   * Saves a registry token for a contributed package-manager plugin.
   * @param pluginId The plugin, untrusted.
   * @param registry The registry, untrusted.
   * @param token The token, untrusted.
   * @returns Returns the new list, or why it was refused.
   */
  private saveToken(pluginId: unknown, registry: unknown, token: unknown): PackageTokenResult {
    if (typeof pluginId !== 'string' || this.host.descriptor(pluginId) === undefined) {
      return { ok: false, error: 'No such package manager is installed.' };
    }
    if (typeof registry !== 'string' || typeof token !== 'string') {
      return { ok: false, error: 'Enter a registry and a token.' };
    }
    const refusal: string | null = this.tokens.save(pluginId, registry, token);
    if (refusal !== null) {
      return { ok: false, error: refusal };
    }
    logger.info('PackageManagerChannels', `Saved a registry token for ${pluginId}`);
    return { ok: true, tokens: this.tokens.list() };
  }

  /**
   * Forgets a registry token. Allowed for a plugin since removed, so a stale token can still go.
   * @param pluginId The plugin, untrusted.
   * @param registry The registry, untrusted.
   * @returns Returns the new list, or why it was refused.
   */
  private clearToken(pluginId: unknown, registry: unknown): PackageTokenResult {
    if (typeof pluginId !== 'string' || typeof registry !== 'string') {
      return { ok: false, error: 'That is not a saved token.' };
    }
    this.tokens.clear(pluginId, registry);
    logger.info('PackageManagerChannels', `Cleared a registry token for ${pluginId}`);
    return { ok: true, tokens: this.tokens.list() };
  }

  /**
   * Determines whether a value names exactly an open workspace root.
   * @param root The candidate.
   * @returns Returns true when it does.
   */
  private isOpenRoot(root: unknown): root is string {
    return typeof root === 'string' && root.length > 0 && this.roots.isRoot(root);
  }
}
