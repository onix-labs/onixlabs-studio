// One folder served over HTTP on 127.0.0.1, with its open pages reloaded when its files change (#1062).
import { createReadStream, promises as fs, watch } from 'node:fs';
import type { FSWatcher, ReadStream, Stats } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { contentTypeOf, isPage } from './content-types';
import {
  CLIENT_PATH,
  changeKind,
  EVENTS_PATH,
  RELOAD_CLIENT,
  withReloadClient,
} from './reload-client';
import { resolveRequest, ResolvedRequest } from './resolve-request';

/**
 * The only address a site listens on: the loopback interface, never the network.
 */
export const LOOPBACK: string = '127.0.0.1';

/**
 * How many ports after the first one a site tries before giving up.
 */
const PORT_ATTEMPTS: number = 100;

/**
 * How long changes are gathered before the pages hear of them, so a save that writes several files —
 * or an editor's write-then-rename — reloads once.
 */
const SETTLE_MS: number = 120;

/**
 * How often an idle event stream is sent a comment, so nothing between the page and the server closes
 * it for being quiet.
 */
const HEARTBEAT_MS: number = 25_000;

/**
 * The headers every response carries: nothing is cached, because the point is to see each save, and
 * nothing is sniffed into a type it was not served as.
 */
const COMMON_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

/**
 * Watches a folder, calling back with the changed files' paths relative to it.
 */
export type FolderWatch = (root: string, onChange: (relative: string) => void) => FSWatcher | null;

/**
 * Watches a folder and everything under it with the platform's own recursive watcher.
 * @param root The folder.
 * @param onChange Called with each changed file's path relative to it.
 * @returns Returns the watcher, or null when the folder cannot be watched.
 */
export function watchFolder(root: string, onChange: (relative: string) => void): FSWatcher | null {
  try {
    const watcher: FSWatcher = watch(
      root,
      { recursive: true },
      (_event: string, file: string | null): void => {
        if (file !== null) {
          onChange(file);
        }
      },
    );
    watcher.on('error', (): void => undefined);
    return watcher;
  } catch {
    return null;
  }
}

/**
 * Determines whether a changed file is one a page could be showing: not inside a dot-folder such as
 * `.git`, and not a dependency folder's churn.
 * @param relative The file's path relative to the folder.
 * @returns Returns true when the pages should hear of it.
 */
export function isServedChange(relative: string): boolean {
  return relative
    .split(/[\\/]/)
    .every((segment: string): boolean => !segment.startsWith('.') && segment !== 'node_modules');
}

/**
 * A folder served on 127.0.0.1.
 */
export class LiveSite {
  /**
   * Holds the served folder's real path.
   */
  private readonly root: string;

  /**
   * Holds how the folder is watched.
   */
  private readonly watchFolder: FolderWatch;

  /**
   * Holds the HTTP server.
   */
  private readonly server: Server;

  /**
   * Holds the open pages' event streams.
   */
  private readonly streams: Set<ServerResponse> = new Set<ServerResponse>();

  /**
   * Holds the files changed since the pages last heard, relative to the folder.
   */
  private readonly changed: Set<string> = new Set<string>();

  /**
   * Holds the port it listens on, or zero before it does.
   */
  private listeningPort: number = 0;

  /**
   * Holds the folder's watcher, or null before it listens and after it closes.
   */
  private watcher: FSWatcher | null = null;

  /**
   * Holds the timer gathering changes, or null when none are waiting.
   */
  private settle: NodeJS.Timeout | null = null;

  /**
   * Holds the timer keeping event streams open.
   */
  private heartbeat: NodeJS.Timeout | null = null;

  /**
   * Initializes a site. Nothing listens until {@link listen} is called.
   * @param root The folder's real path.
   * @param folderWatch How the folder is watched; defaults to the platform's recursive watcher.
   */
  public constructor(root: string, folderWatch: FolderWatch = watchFolder) {
    this.root = root;
    this.watchFolder = folderWatch;
    this.server = createServer((request: IncomingMessage, response: ServerResponse): void => {
      void this.handle(request, response);
    });
  }

  /**
   * Gets the port the site listens on.
   * @returns Returns the port, or zero before it listens.
   */
  public get port(): number {
    return this.listeningPort;
  }

  /**
   * Listens on 127.0.0.1, on the first free port from the one asked for, and starts watching.
   * @param firstPort The port to try first; zero takes any free one.
   * @returns Returns the port it listens on.
   */
  public async listen(firstPort: number): Promise<number> {
    let lastError: unknown = new Error('No port was tried.');
    const attempts: number = firstPort === 0 ? 1 : PORT_ATTEMPTS;
    for (let offset: number = 0; offset < attempts; offset += 1) {
      const port: number = firstPort === 0 ? 0 : firstPort + offset;
      if (port > 65_535) {
        break;
      }
      try {
        this.listeningPort = await this.tryListen(port);
        this.watcher = this.watchFolder(this.root, (relative: string): void =>
          this.noteChange(relative),
        );
        this.heartbeat = setInterval((): void => this.beat(), HEARTBEAT_MS);
        this.heartbeat.unref();
        return this.listeningPort;
      } catch (error: unknown) {
        lastError = error;
        if (!isAddressInUse(error)) {
          break;
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  /**
   * Tells the open pages that files changed, as the watcher would.
   * @param changed The changed files, relative to the folder, with `/` separators.
   */
  public notify(changed: readonly string[]): void {
    const message: string = JSON.stringify({ type: changeKind(changed), paths: changed });
    for (const stream of this.streams) {
      stream.write(`data: ${message}\n\n`);
    }
  }

  /**
   * Stops listening, closing every page's connection and the watcher, which frees the port.
   * @returns Returns a promise that resolves once the port is free.
   */
  public async close(): Promise<void> {
    this.watcher?.close();
    this.watcher = null;
    if (this.settle !== null) {
      clearTimeout(this.settle);
      this.settle = null;
    }
    if (this.heartbeat !== null) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    for (const stream of this.streams) {
      stream.end();
    }
    this.streams.clear();
    this.server.closeAllConnections();
    await new Promise<void>((resolve: () => void): void => {
      this.server.close((): void => resolve());
    });
  }

  /**
   * Listens on one port.
   * @param port The port.
   * @returns Returns the port listened on.
   */
  private tryListen(port: number): Promise<number> {
    return new Promise<number>(
      (resolve: (port: number) => void, reject: (error: Error) => void): void => {
        const onError: (error: Error) => void = (error: Error): void => {
          this.server.off('listening', onListening);
          reject(error);
        };
        const onListening: () => void = (): void => {
          this.server.off('error', onError);
          const address: string | AddressInfo | null = this.server.address();
          resolve(typeof address === 'object' && address !== null ? address.port : port);
        };
        this.server.once('error', onError);
        this.server.once('listening', onListening);
        this.server.listen(port, LOOPBACK);
      },
    );
  }

  /**
   * Gathers a changed file, telling the pages once the changes settle.
   * @param relative The file's path relative to the folder.
   */
  private noteChange(relative: string): void {
    if (!isServedChange(relative)) {
      return;
    }
    this.changed.add(relative.split('\\').join('/'));
    this.settle ??= setTimeout((): void => {
      this.settle = null;
      const changed: readonly string[] = [...this.changed];
      this.changed.clear();
      this.notify(changed);
    }, SETTLE_MS);
  }

  /**
   * Keeps every open event stream alive.
   */
  private beat(): void {
    for (const stream of this.streams) {
      stream.write(': keep-alive\n\n');
    }
  }

  /**
   * Answers one request.
   * @param request The request.
   * @param response The response.
   * @returns Returns a promise that resolves once it is answered.
   */
  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (!this.isOwnHost(request.headers.host)) {
        // A host name rebound onto 127.0.0.1 by a page elsewhere is not this site's name.
        this.fail(response, 403, 'Forbidden');
        return;
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.setHeader('Allow', 'GET, HEAD');
        this.fail(response, 405, 'Method Not Allowed');
        return;
      }
      const target: string = request.url ?? '/';
      if (target === CLIENT_PATH || target.startsWith(`${CLIENT_PATH}?`)) {
        this.send(response, request, 'text/javascript; charset=utf-8', RELOAD_CLIENT);
        return;
      }
      if (target === EVENTS_PATH) {
        this.openStream(request, response);
        return;
      }
      await this.serve(request, response, await resolveRequest(this.root, target));
    } catch {
      if (!response.headersSent) {
        this.fail(response, 500, 'Internal Server Error');
      } else {
        response.destroy();
      }
    }
  }

  /**
   * Determines whether a request was addressed to this site: by `127.0.0.1` or `localhost`, on its
   * port.
   * @param host The request's Host header.
   * @returns Returns true when it was.
   */
  private isOwnHost(host: string | undefined): boolean {
    if (host === undefined) {
      return false;
    }
    const lowered: string = host.toLowerCase();
    return (
      lowered === `${LOOPBACK}:${this.listeningPort}` ||
      lowered === `localhost:${this.listeningPort}`
    );
  }

  /**
   * Serves what a request's path resolved to.
   * @param request The request.
   * @param response The response.
   * @param resolved What the path resolved to.
   * @returns Returns a promise that resolves once it is answered.
   */
  private async serve(
    request: IncomingMessage,
    response: ServerResponse,
    resolved: ResolvedRequest,
  ): Promise<void> {
    switch (resolved.kind) {
      case 'forbidden':
        this.fail(response, 403, 'Forbidden');
        return;
      case 'not-found':
        this.fail(response, 404, 'Not Found');
        return;
      case 'redirect':
        response.writeHead(301, { ...COMMON_HEADERS, Location: resolved.location });
        response.end();
        return;
      case 'file':
        if (isPage(resolved.file)) {
          const html: string = await fs.readFile(resolved.file, 'utf8');
          this.send(response, request, contentTypeOf(resolved.file), withReloadClient(html));
          return;
        }
        await this.stream(request, response, resolved.file);
        return;
    }
  }

  /**
   * Streams a file as it is on disk.
   * @param request The request.
   * @param response The response.
   * @param file The file's real path.
   * @returns Returns a promise that resolves once it is sent.
   */
  private async stream(
    request: IncomingMessage,
    response: ServerResponse,
    file: string,
  ): Promise<void> {
    const stats: Stats = await fs.stat(file);
    response.writeHead(200, {
      ...COMMON_HEADERS,
      'Content-Type': contentTypeOf(file),
      'Content-Length': String(stats.size),
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    await new Promise<void>((resolve: () => void): void => {
      const body: ReadStream = createReadStream(file);
      body.on('error', (): void => {
        response.destroy();
        resolve();
      });
      body.on('end', (): void => resolve());
      body.pipe(response);
    });
  }

  /**
   * Opens a page's event stream, which the reload script listens on.
   * @param request The request.
   * @param response The response.
   */
  private openStream(request: IncomingMessage, response: ServerResponse): void {
    response.writeHead(200, {
      ...COMMON_HEADERS,
      'Content-Type': 'text/event-stream; charset=utf-8',
      Connection: 'keep-alive',
    });
    response.write(': connected\n\n');
    this.streams.add(response);
    request.on('close', (): void => {
      this.streams.delete(response);
    });
  }

  /**
   * Sends a body held in memory.
   * @param response The response.
   * @param request The request, for whether a body is wanted.
   * @param contentType The body's type.
   * @param body The body.
   */
  private send(
    response: ServerResponse,
    request: IncomingMessage,
    contentType: string,
    body: string,
  ): void {
    response.writeHead(200, {
      ...COMMON_HEADERS,
      'Content-Type': contentType,
      'Content-Length': String(Buffer.byteLength(body)),
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  }

  /**
   * Answers with an error and nothing about the disk.
   * @param response The response.
   * @param status The status.
   * @param text The status text, which is also the body.
   */
  private fail(response: ServerResponse, status: number, text: string): void {
    response.writeHead(status, { ...COMMON_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(text);
  }
}

/**
 * Determines whether listening failed because the port is taken.
 * @param error The failure.
 * @returns Returns true when it was.
 */
function isAddressInUse(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'EADDRINUSE' || error.code === 'EACCES')
  );
}
