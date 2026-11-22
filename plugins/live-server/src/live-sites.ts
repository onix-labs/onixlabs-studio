// Answers Studio's requests: the sites this process serves, by identifier (#1062).
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import type { Stats } from 'node:fs';
import * as path from 'node:path';
import { LiveSite } from './live-site';
import { FolderPoll, pollIntervalOf } from './poll-folder';
import { LIVE_SERVER_PROTOCOL, Serving } from './protocol';

/**
 * Creates the site for a folder, polled on the given interval in milliseconds when Studio asked for
 * polling and watched by the platform otherwise.
 */
export type SiteFactory = (root: string, pollIntervalMs: number | undefined) => LiveSite;

/**
 * Creates a real site: watched by the platform, or polled where Studio says the platform's watching
 * misses changes, such as on a network share (#1254).
 * @param root The folder's real path.
 * @param pollIntervalMs How often to poll, or undefined to watch natively.
 * @returns Returns the site.
 */
function createLiveSite(root: string, pollIntervalMs: number | undefined): LiveSite {
  return pollIntervalMs === undefined
    ? new LiveSite(root)
    : new LiveSite(
        root,
        (folder: string, onChange: (relative: string) => void): FolderPoll =>
          new FolderPoll(folder, pollIntervalMs, onChange),
      );
}

/**
 * The sites one plugin process serves.
 */
export class LiveSites {
  /**
   * Holds the running sites, by identifier.
   */
  private readonly sites: Map<string, LiveSite> = new Map<string, LiveSite>();

  /**
   * Holds how a site is created.
   */
  private readonly createSite: SiteFactory;

  /**
   * Initializes the set.
   * @param createSite How a site is created; defaults to a real one.
   */
  public constructor(createSite: SiteFactory = createLiveSite) {
    this.createSite = createSite;
  }

  /**
   * Answers one request.
   * @param op The operation.
   * @param params Its parameters, untrusted.
   * @returns Returns the result.
   */
  public async answer(op: string, params: Record<string, unknown>): Promise<unknown> {
    switch (op) {
      case 'initialize':
        return { protocol: LIVE_SERVER_PROTOCOL };
      case 'serve':
        return await this.serve(params['root'], params['port'], params['pollIntervalMs']);
      case 'stop':
        await this.stop(params['serverId']);
        return {};
      default:
        throw new Error(`Unknown operation ${op}.`);
    }
  }

  /**
   * Stops every site, freeing every port.
   * @returns Returns a promise that resolves once they have stopped.
   */
  public async closeAll(): Promise<void> {
    const sites: readonly LiveSite[] = [...this.sites.values()];
    this.sites.clear();
    await Promise.all(sites.map((site: LiveSite): Promise<void> => site.close()));
  }

  /**
   * Starts serving a folder.
   * @param root The folder, untrusted.
   * @param port The port to try first, untrusted.
   * @param pollIntervalMs How often to poll the folder, untrusted; absent to watch natively.
   * @returns Returns the site's identifier and port.
   */
  private async serve(root: unknown, port: unknown, pollIntervalMs: unknown): Promise<Serving> {
    if (typeof root !== 'string' || !path.isAbsolute(root) || root.includes('\0')) {
      throw new Error('The folder to serve is not an absolute path.');
    }
    const first: number =
      typeof port === 'number' && Number.isInteger(port) && port >= 0 && port <= 65_535 ? port : 0;
    // The folder's own real path, so every file's real path is compared against the same thing.
    const real: string = await fs.realpath(root);
    const stats: Stats = await fs.stat(real);
    if (!stats.isDirectory()) {
      throw new Error('The folder to serve is not a folder.');
    }
    const site: LiveSite = this.createSite(real, pollIntervalOf(pollIntervalMs));
    const listening: number = await site.listen(first);
    const serverId: string = randomUUID();
    this.sites.set(serverId, site);
    return { serverId, port: listening };
  }

  /**
   * Stops serving a folder. Stopping one that is not served does nothing.
   * @param serverId The site's identifier, untrusted.
   * @returns Returns a promise that resolves once it has stopped.
   */
  private async stop(serverId: unknown): Promise<void> {
    if (typeof serverId !== 'string') {
      return;
    }
    const site: LiveSite | undefined = this.sites.get(serverId);
    this.sites.delete(serverId);
    await site?.close();
  }
}
