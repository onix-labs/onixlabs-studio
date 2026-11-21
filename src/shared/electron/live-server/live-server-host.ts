import { promises as fs } from 'node:fs';
import type { Stats } from 'node:fs';
import * as path from 'node:path';
import type { LiveServerResponse, LiveServerServing } from '@shared/api/live-server-protocol';
import type {
  LiveServerAvailability,
  LiveServerInfo,
  LiveServerOpenAnswer,
} from '@shared/api/live-server-channels';
import { logger } from '../logger';
import { LiveServerClient } from './live-server-client';
import {
  LiveServerDescriptor,
  LiveServerResolution,
  LiveServerSpec,
} from './live-server-descriptor';
import { LiveServerEndpoint } from './live-server-endpoint';

/**
 * Specifies the port a server tries first, as VS Code's Live Server does, so a habit carries over.
 */
export const LIVE_SERVER_FIRST_PORT: number = 5500;

/**
 * Specifies how long starting or stopping a server may take.
 */
const REQUEST_TIMEOUT_MS: number = 15_000;

/**
 * Lists the file extensions Open with Live Server opens: pages, which are what a browser shows.
 */
const PAGE_EXTENSIONS: readonly string[] = ['.html', '.htm'];

/**
 * The part of the open-workspace registry a page is checked against.
 */
export interface LiveServerRoots {
  /**
   * Determines whether a path is an open workspace root or lies inside one.
   * @param target The path to test.
   * @returns Returns true when the path is within an open workspace root.
   */
  isWithin(target: unknown): boolean;

  /**
   * Determines whether a path is exactly an open workspace root.
   * @param target The path to test.
   * @returns Returns true when it is one.
   */
  isRoot(target: string): boolean;

  /**
   * Finds the deepest open workspace root a path lies inside.
   * @param target The path to test.
   * @returns Returns the root, or undefined when it lies inside none.
   */
  rootContaining(target: string): string | undefined;
}

/**
 * Creates the endpoint for a plugin's process.
 */
export type LiveServerClientFactory = (
  id: string,
  spec: LiveServerSpec,
  onExited: () => void,
) => LiveServerEndpoint;

/**
 * Describes what the host depends on, injectable so it is testable without processes or a disk.
 */
export interface LiveServerHostOptions {
  /**
   * Gets the contributed live-server plugins, read afresh each time so an install or uninstall is seen
   * without a restart.
   */
  readonly descriptors: () => readonly LiveServerDescriptor[];

  /**
   * Gets the open workspace roots every page must lie within.
   */
  readonly roots: LiveServerRoots;

  /**
   * Called with the running servers whenever they change, so every window can redraw its chip.
   */
  readonly onChanged: (servers: readonly LiveServerInfo[]) => void;

  /**
   * Follows a path's links. Defaults to the filesystem.
   */
  readonly realPath?: (target: string) => Promise<string>;

  /**
   * Says whether a path is a file. Defaults to the filesystem.
   */
  readonly isFile?: (target: string) => Promise<boolean>;

  /**
   * Creates the client for a plugin's process. Defaults to a real process.
   */
  readonly createClient?: LiveServerClientFactory;
}

/**
 * Describes a running server.
 */
interface RunningServer {
  /**
   * Gets the workspace root it serves, as the renderer opened it.
   */
  readonly root: string;

  /**
   * Gets the root's real path, which is what the plugin serves and pages are relative to.
   */
  readonly realRoot: string;

  /**
   * Gets the identifier the plugin knows it by.
   */
  readonly serverId: string;

  /**
   * Gets the port it listens on.
   */
  readonly port: number;

  /**
   * Gets the plugin serving it.
   */
  readonly descriptor: LiveServerDescriptor;
}

/**
 * Describes a running plugin process.
 */
interface RunningPlugin {
  /**
   * Gets the plugin's descriptor.
   */
  readonly descriptor: LiveServerDescriptor;

  /**
   * Gets the endpoint answering for it.
   */
  readonly client: LiveServerEndpoint;
}

/**
 * Describes a page checked and placed in its workspace.
 */
interface CheckedPage {
  /**
   * Gets the workspace root the page lies in.
   */
  readonly root: string;

  /**
   * Gets the root's real path.
   */
  readonly realRoot: string;

  /**
   * Gets the page's path from the real root, with `/` separators.
   */
  readonly relative: string;
}

/**
 * Hosts the live-server plugin in the main process (#1062): starts it on first use, keeps one server
 * per workspace, and stands between it and an untrusted renderer.
 *
 * ⛔ Every check lives here as well as in the plugin, because a plugin is code Studio did not write:
 * - a page must be an absolute path to an HTML file inside an open workspace, and its real path — its
 *   links followed — must be inside the workspace's real path too;
 * - the folder served is the workspace root, never a path the renderer names, so a request cannot widen
 *   what is served;
 * - a port the plugin answers with must be a real one, or the server is not believed;
 * - closing the workspace stops its server, and so does the plugin being updated or removed.
 */
export class LiveServerHost {
  /**
   * Holds the dependencies.
   */
  private readonly options: LiveServerHostOptions;

  /**
   * Holds the running servers, keyed by workspace root.
   */
  private readonly servers: Map<string, RunningServer> = new Map<string, RunningServer>();

  /**
   * Holds the servers being started, keyed by workspace root, so two opens start one.
   */
  private readonly starting: Map<string, Promise<RunningServer | string>> = new Map<
    string,
    Promise<RunningServer | string>
  >();

  /**
   * Holds the running plugin process, or null before the first open.
   */
  private plugin: RunningPlugin | null = null;

  /**
   * Holds the start of the plugin process in progress, so two first opens start one process.
   */
  private pluginStarting: Promise<RunningPlugin | string> | null = null;

  /**
   * Initializes the host.
   * @param options What the host depends on.
   */
  public constructor(options: LiveServerHostOptions) {
    this.options = options;
  }

  /**
   * Says whether a live server can be offered.
   * @returns Returns `ready` when one is installed, `not-installed` when one is contributed but none is
   * installed, and `none` when no plugin contributes one.
   */
  public availability(): LiveServerAvailability {
    const descriptors: readonly LiveServerDescriptor[] = this.options.descriptors();
    if (descriptors.length === 0) {
      return 'none';
    }
    return descriptors.some(
      (descriptor: LiveServerDescriptor): boolean => descriptor.resolve().available,
    )
      ? 'ready'
      : 'not-installed';
  }

  /**
   * Lists the running servers.
   * @returns Returns them, in the order they started.
   */
  public list(): readonly LiveServerInfo[] {
    return [...this.servers.values()].map(toInfo);
  }

  /**
   * Serves the workspace a page lies in — starting its server when none runs, reusing it when one does —
   * and answers with the page's address.
   * @param file The page's absolute path, untrusted.
   * @returns Returns the server and the page's address, or why there is none.
   */
  public async open(file: unknown): Promise<LiveServerOpenAnswer> {
    const page: CheckedPage | string = await this.checkPage(file);
    if (typeof page === 'string') {
      return { ok: false, error: page };
    }
    const server: RunningServer | string = await this.serverFor(page);
    if (typeof server === 'string') {
      return { ok: false, error: server };
    }
    return { ok: true, server: toInfo(server), pageUrl: pageUrl(server, page.relative) };
  }

  /**
   * Stops a workspace's server, freeing its port. Stopping one that is not running does nothing.
   * @param root The workspace root, untrusted.
   * @returns Returns a promise that resolves once it has stopped.
   */
  public async stop(root: unknown): Promise<void> {
    if (typeof root !== 'string' || root.length === 0) {
      return;
    }
    await this.stopServer(path.resolve(root));
  }

  /**
   * Stops the servers of a workspace that has closed, and of any workspace inside it.
   * @param root The closed workspace root.
   */
  public stopWithin(root: string): void {
    const closed: string = path.resolve(root);
    for (const key of [...this.servers.keys()]) {
      if (key === closed || key.startsWith(closed + path.sep)) {
        void this.stopServer(key);
      }
    }
  }

  /**
   * Stops the plugin's process after an install or removal, dropping every server it ran; the next
   * open starts whatever is installed now.
   * @param id The plugin that changed.
   */
  public restartPlugin(id: string): void {
    if (this.plugin?.descriptor.id !== id) {
      return;
    }
    this.plugin.client.dispose();
    this.plugin = null;
    this.forgetServers();
  }

  /**
   * Stops the plugin's process, which closes every port it held.
   */
  public dispose(): void {
    this.plugin?.client.dispose();
    this.plugin = null;
    this.servers.clear();
  }

  /**
   * Checks a page the renderer asked to open, and places it in its workspace.
   * @param file The page's path, untrusted.
   * @returns Returns the checked page, or why it was refused.
   */
  private async checkPage(file: unknown): Promise<CheckedPage | string> {
    if (
      typeof file !== 'string' ||
      file.length === 0 ||
      file.includes('\0') ||
      !path.isAbsolute(file)
    ) {
      return 'The page to open is not a file path.';
    }
    if (!PAGE_EXTENSIONS.includes(path.extname(file).toLowerCase())) {
      return 'Live Server opens HTML pages.';
    }
    const resolved: string = path.resolve(file);
    if (!this.options.roots.isWithin(resolved)) {
      return 'The page is not in an open workspace.';
    }
    const root: string | undefined = this.options.roots.rootContaining(resolved);
    if (root === undefined) {
      return 'The page is not in an open workspace.';
    }
    const realPath: (target: string) => Promise<string> = this.options.realPath ?? fs.realpath;
    let realRoot: string;
    let realFile: string;
    try {
      [realRoot, realFile] = await Promise.all([realPath(root), realPath(resolved)]);
    } catch {
      return 'The page could not be found.';
    }
    if (!realFile.startsWith(realRoot + path.sep)) {
      // A link out of the workspace: its target is not the workspace's to serve.
      return 'The page is outside its workspace.';
    }
    if (!(await (this.options.isFile ?? isFile)(realFile))) {
      return 'The page could not be found.';
    }
    return {
      root,
      realRoot,
      relative: path.relative(realRoot, realFile).split(path.sep).join('/'),
    };
  }

  /**
   * Gets the server of a page's workspace, starting it when none runs.
   * @param page The checked page.
   * @returns Returns the server, or why it could not be started.
   */
  private async serverFor(page: CheckedPage): Promise<RunningServer | string> {
    const running: RunningServer | undefined = this.servers.get(page.root);
    if (running !== undefined && this.plugin?.client.running === true) {
      return running;
    }
    const pending: Promise<RunningServer | string> | undefined = this.starting.get(page.root);
    if (pending !== undefined) {
      return await pending;
    }
    const started: Promise<RunningServer | string> = this.startServer(page);
    this.starting.set(page.root, started);
    try {
      return await started;
    } finally {
      this.starting.delete(page.root);
    }
  }

  /**
   * Starts a workspace's server.
   * @param page The checked page whose workspace is served.
   * @returns Returns the server, or why it could not be started.
   */
  private async startServer(page: CheckedPage): Promise<RunningServer | string> {
    const plugin: RunningPlugin | string = await this.ensurePlugin();
    if (typeof plugin === 'string') {
      return plugin;
    }
    const response: LiveServerResponse<'serve'> = await plugin.client.request(
      'serve',
      { root: page.realRoot, port: LIVE_SERVER_FIRST_PORT },
      REQUEST_TIMEOUT_MS,
    );
    if (!response.ok) {
      if (response.timedOut === true) {
        // The plugin may still finish starting a server nobody is waiting for, which no stop could
        // name. Stopping its process is the only way to be sure that port is freed.
        logger.warn(
          'LiveServerHost',
          `'${plugin.descriptor.id}' did not answer serve; restarting it`,
        );
        this.restartPlugin(plugin.descriptor.id);
      }
      return response.error;
    }
    const serving: LiveServerServing | null = readServing(response.result);
    if (serving === null) {
      logger.warn('LiveServerHost', `'${plugin.descriptor.id}' answered serve with no server`);
      return `${plugin.descriptor.displayName} did not say where it is serving.`;
    }
    if (!this.options.roots.isRoot(page.root)) {
      // The workspace closed while its server was starting, after stopWithin had looked.
      logger.info('LiveServerHost', `${page.root} closed while its server started; stopping it`);
      await plugin.client.request('stop', { serverId: serving.serverId }, REQUEST_TIMEOUT_MS);
      return 'The workspace closed before its server started.';
    }
    const server: RunningServer = {
      root: page.root,
      realRoot: page.realRoot,
      serverId: serving.serverId,
      port: serving.port,
      descriptor: plugin.descriptor,
    };
    this.servers.set(page.root, server);
    logger.info('LiveServerHost', `Serving ${page.root} on 127.0.0.1:${server.port}`);
    this.announce();
    return server;
  }

  /**
   * Stops one server, when it is running.
   * @param root The resolved workspace root.
   * @returns Returns a promise that resolves once it has stopped.
   */
  private async stopServer(root: string): Promise<void> {
    const server: RunningServer | undefined = this.servers.get(root);
    if (server === undefined) {
      return;
    }
    this.servers.delete(root);
    this.announce();
    const response: LiveServerResponse<'stop'> | undefined = await this.plugin?.client.request(
      'stop',
      { serverId: server.serverId },
      REQUEST_TIMEOUT_MS,
    );
    if (response?.ok === false) {
      logger.warn('LiveServerHost', `Could not stop the server of ${root}: ${response.error}`);
    } else {
      logger.info('LiveServerHost', `Stopped serving ${root}`);
    }
  }

  /**
   * Gets the running plugin, starting the installed one with the highest priority on first use.
   * @returns Returns the plugin, or why none could be started.
   */
  private async ensurePlugin(): Promise<RunningPlugin | string> {
    if (this.plugin?.client.running === true) {
      return this.plugin;
    }
    this.pluginStarting ??= this.startPlugin();
    try {
      return await this.pluginStarting;
    } finally {
      this.pluginStarting = null;
    }
  }

  /**
   * Starts the installed live-server plugin with the highest priority.
   * @returns Returns the plugin, or why none could be started.
   */
  private async startPlugin(): Promise<RunningPlugin | string> {
    const descriptors: readonly LiveServerDescriptor[] = [...this.options.descriptors()].sort(
      (a: LiveServerDescriptor, b: LiveServerDescriptor): number => b.priority - a.priority,
    );
    if (descriptors.length === 0) {
      return 'No Live Server plugin is installed.';
    }
    let reason: string = '';
    for (const descriptor of descriptors) {
      const resolution: LiveServerResolution = descriptor.resolve();
      if (!resolution.available) {
        reason ||= resolution.reason;
        continue;
      }
      const create: LiveServerClientFactory =
        this.options.createClient ??
        ((id: string, spec: LiveServerSpec, onExited: () => void): LiveServerEndpoint =>
          new LiveServerClient(id, spec, onExited));
      const client: LiveServerEndpoint = create(descriptor.id, resolution.spec, (): void =>
        this.onPluginExited(client),
      );
      this.plugin?.client.dispose();
      this.plugin = null;
      this.forgetServers();
      if ((await client.start()) === null) {
        client.dispose();
        return `${descriptor.displayName} could not be started.`;
      }
      this.plugin = { descriptor, client };
      return this.plugin;
    }
    return reason;
  }

  /**
   * Drops every server when the plugin exits on its own: its ports closed with it.
   * @param client The client whose process exited.
   */
  private onPluginExited(client: LiveServerEndpoint): void {
    if (this.plugin?.client !== client) {
      return;
    }
    this.plugin = null;
    this.forgetServers();
  }

  /**
   * Forgets every server, and says so when there were any.
   */
  private forgetServers(): void {
    if (this.servers.size === 0) {
      return;
    }
    this.servers.clear();
    this.announce();
  }

  /**
   * Tells the windows the running servers changed.
   */
  private announce(): void {
    this.options.onChanged(this.list());
  }
}

/**
 * Describes a running server for the renderer.
 * @param server The server.
 * @returns Returns its description.
 */
function toInfo(server: RunningServer): LiveServerInfo {
  return {
    root: server.root,
    url: `http://127.0.0.1:${server.port}/`,
    port: server.port,
    displayName: server.descriptor.displayName,
  };
}

/**
 * Builds a page's address on its server: a folder's `index.html` is the folder's own address, as a
 * browser would ask for it.
 * @param server The server.
 * @param relative The page's path from the served folder, with `/` separators.
 * @returns Returns the address.
 */
function pageUrl(server: RunningServer, relative: string): string {
  const segments: string[] = relative.split('/');
  if (segments[segments.length - 1].toLowerCase() === 'index.html') {
    segments[segments.length - 1] = '';
  }
  return `${toInfo(server).url}${segments.map(encodeURIComponent).join('/')}`;
}

/**
 * Narrows a plugin's untrusted answer to `serve`: a server identifier, and a port a server can listen
 * on.
 * @param value The answer.
 * @returns Returns the server, or null when the answer is not one.
 */
function readServing(value: unknown): LiveServerServing | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record: Record<string, unknown> = value as Record<string, unknown>;
  const serverId: unknown = record['serverId'];
  const port: unknown = record['port'];
  if (
    typeof serverId !== 'string' ||
    serverId.length === 0 ||
    typeof port !== 'number' ||
    !Number.isInteger(port) ||
    port <= 0 ||
    port > 65_535
  ) {
    return null;
  }
  return { serverId, port };
}

/**
 * Says whether a path is a file on disk.
 * @param target The path.
 * @returns Returns true when it is one.
 */
async function isFile(target: string): Promise<boolean> {
  try {
    const stats: Stats = await fs.stat(target);
    return stats.isFile();
  } catch {
    return false;
  }
}
