import { Buffer } from 'node:buffer';
import type {
  ClientRequest,
  IncomingMessage,
  OutgoingHttpHeaders,
  RequestOptions,
} from 'node:http';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { Socket } from 'node:net';
import type { Readable } from 'node:stream';
import { connect as tlsConnect } from 'node:tls';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import type { ApiProxy, ApiSelfSignedPolicy } from '@shared/api/api-client-types';

/**
 * The most redirects one send follows, the limit browsers and fetch use.
 */
const MAX_REDIRECTS: number = 20;

/**
 * The statuses that redirect and carry a `Location`.
 */
const REDIRECT_STATUSES: ReadonlySet<number> = new Set<number>([301, 302, 303, 307, 308]);

/**
 * The port an address without one is reached on, by scheme.
 */
const DEFAULT_PORTS: Readonly<Record<string, number>> = { 'http:': 80, 'https:': 443 };

/**
 * Matches an IPv4 loopback address. Whole-address, because `127.example.com` is somebody else's server
 * and being taken for this machine would turn off its certificate check.
 */
const LOOPBACK_ADDRESS: RegExp = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/**
 * The schemes a request may go to, by redirect or otherwise.
 */
const WEB_SCHEMES: ReadonlySet<string> = new Set<string>(['http:', 'https:']);

/**
 * Describes one request as the transport sends it.
 */
export interface TransportRequest {
  /**
   * Gets the HTTP method.
   */
  readonly method: string;

  /**
   * Gets the absolute URL.
   */
  readonly url: string;

  /**
   * Gets the headers.
   */
  readonly headers: Readonly<Record<string, string>>;

  /**
   * Gets the body, or null for none.
   */
  readonly body: string | null;

  /**
   * Gets whether redirects are followed, rather than reported.
   */
  readonly followRedirects: boolean;

  /**
   * Gets the most bytes of body read; a longer body is cut there.
   */
  readonly maxBodyBytes: number;

  /**
   * Gets whose certificates that can't be verified are accepted.
   */
  readonly acceptSelfSigned: ApiSelfSignedPolicy;

  /**
   * Gets how the request reaches its server.
   */
  readonly proxy: ApiProxy;

  /**
   * Gets the signal that abandons the request; its reason is what the send rejects with.
   */
  readonly signal: AbortSignal;
}

/**
 * Describes the response the transport read.
 */
export interface TransportResponse {
  /**
   * Gets the HTTP status code.
   */
  readonly status: number;

  /**
   * Gets the HTTP status text.
   */
  readonly statusText: string;

  /**
   * Gets the response headers.
   */
  readonly headers: Readonly<Record<string, string>>;

  /**
   * Gets the body as read, decompressed.
   */
  readonly body: Uint8Array;

  /**
   * Gets the body's size: as the server stated it, else as read.
   */
  readonly sizeBytes: number;

  /**
   * Gets whether the body was cut at the limit.
   */
  readonly truncated: boolean;

  /**
   * Gets the URL that answered, after any redirects.
   */
  readonly finalUrl: string;

  /**
   * Gets whether a redirect was followed.
   */
  readonly redirected: boolean;

  /**
   * Gets when the headers arrived, as the time since the send began, in milliseconds.
   */
  readonly firstByteMs: number;
}

/**
 * Sends a request and reads its response.
 */
export type ApiTransport = (request: TransportRequest) => Promise<TransportResponse>;

/**
 * Asks the system how a URL is reached, in the PAC format: `DIRECT`, or `PROXY host:port`.
 */
export type SystemProxyResolver = (url: string) => Promise<string>;

/**
 * Determines whether a host is this machine.
 * @param hostname The URL's host name.
 * @returns Returns true for a loopback name or address.
 */
export function isLocalHost(hostname: string): boolean {
  const host: string = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '::1' ||
    LOOPBACK_ADDRESS.test(host)
  );
}

/**
 * Determines whether a host is on a Custom proxy's bypass list: whole names, or `*.` and `.` suffixes.
 * @param hostname The URL's host name.
 * @param bypass The list, separated by commas, semicolons or spaces.
 * @returns Returns true when the host goes direct.
 */
export function isBypassed(hostname: string, bypass: string): boolean {
  const host: string = hostname.toLowerCase();
  return bypass
    .split(/[\s,;]+/)
    .map((entry: string): string => entry.trim().toLowerCase())
    .some((entry: string): boolean => {
      if (entry.length === 0) {
        return false;
      }
      const suffix: string = entry.replace(/^\*/, '');
      return suffix.startsWith('.') ? host.endsWith(suffix) : host === entry;
    });
}

/**
 * Finds the proxy a URL goes through.
 * @param url The URL.
 * @param proxy The Proxy setting.
 * @param system Asks the system.
 * @returns Returns a promise resolving the proxy as `host:port`, or null to go direct.
 */
export async function proxyFor(
  url: URL,
  proxy: ApiProxy,
  system: SystemProxyResolver,
): Promise<string | null> {
  if (proxy.mode === 'none' || isLocalHost(url.hostname)) {
    return null;
  }
  if (proxy.mode === 'custom') {
    const address: string = proxy.address.trim().replace(/^https?:\/\//i, '');
    return address.length === 0 || isBypassed(url.hostname, proxy.bypass) ? null : address;
  }
  // PAC answers list what to try in turn. Only a plain HTTP proxy can be spoken here.
  const first: string = (await system(url.href)).split(';')[0].trim();
  return first.toUpperCase().startsWith('PROXY ') ? first.slice('PROXY '.length).trim() : null;
}

/**
 * Finds the request a redirect leads to, following what fetch does: 303 becomes GET, as do 301 and 302
 * from a POST, and credentials stay with the origin they were meant for.
 * @param request The request that redirected.
 * @param status The redirect's status.
 * @param location Where it leads, absolute.
 * @returns Returns the method, headers and body to send there.
 */
export function redirected(
  request: Pick<TransportRequest, 'method' | 'url' | 'headers' | 'body'>,
  status: number,
  location: string,
): Pick<TransportRequest, 'method' | 'url' | 'headers' | 'body'> {
  const toGet: boolean =
    status === 303 ||
    ((status === 301 || status === 302) && request.method.toUpperCase() === 'POST');
  const headers: Record<string, string> = {};
  const sameOrigin: boolean = new URL(request.url).origin === new URL(location).origin;
  for (const [name, value] of Object.entries(request.headers)) {
    const key: string = name.toLowerCase();
    const credential: boolean =
      key === 'authorization' || key === 'cookie' || key === 'proxy-authorization';
    const bodyHeader: boolean = key === 'content-type' || key === 'content-length';
    if (key !== 'host' && (sameOrigin || !credential) && !(toGet && bodyHeader)) {
      headers[name] = value;
    }
  }
  return {
    method: toGet ? 'GET' : request.method,
    url: location,
    headers,
    body: toGet ? null : request.body,
  };
}

/**
 * Adds what every send carries unless the user set it, as fetch does.
 * @param headers The request's headers.
 * @returns Returns the headers to send.
 */
function withDefaults(headers: Readonly<Record<string, string>>): OutgoingHttpHeaders {
  const names: ReadonlySet<string> = new Set<string>(
    Object.keys(headers).map((name: string): string => name.toLowerCase()),
  );
  return {
    ...(names.has('accept') ? {} : { accept: '*/*' }),
    ...(names.has('accept-encoding') ? {} : { 'accept-encoding': 'gzip, deflate, br' }),
    ...(names.has('user-agent') ? {} : { 'user-agent': 'ONIXLabs Studio' }),
    ...headers,
  };
}

/**
 * Opens a tunnel to a host through a proxy.
 * @param proxy The proxy, as `host:port`.
 * @param host The host to reach.
 * @param port The port to reach.
 * @param signal Abandons the attempt.
 * @returns Returns a promise resolving the tunnelled socket.
 */
function openTunnel(
  proxy: string,
  host: string,
  port: number,
  signal: AbortSignal,
): Promise<Socket> {
  const [proxyHost, proxyPort]: string[] = proxy.split(':');
  return new Promise<Socket>(
    (resolve: (socket: Socket) => void, reject: (reason: unknown) => void): void => {
      const connect: ClientRequest = httpRequest({
        host: proxyHost,
        port: Number(proxyPort) || DEFAULT_PORTS['http:'],
        method: 'CONNECT',
        path: `${host}:${port}`,
      });
      signal.addEventListener('abort', (): void => {
        connect.destroy(signal.reason as Error);
      });
      connect.once('connect', (response: IncomingMessage, socket: Socket): void => {
        if (response.statusCode === 200) {
          resolve(socket);
          return;
        }
        socket.destroy();
        reject(new Error(`Proxy ${proxy} refused the tunnel: ${response.statusCode}`));
      });
      connect.once('error', reject);
      connect.end();
    },
  );
}

/**
 * Sends one hop of a request, resolving when its headers arrive.
 * @param url The URL.
 * @param method The method.
 * @param headers The headers.
 * @param body The body.
 * @param verify Whether the server's certificate must verify.
 * @param proxy The proxy to go through, as `host:port`, or null.
 * @param signal Abandons the send.
 * @returns Returns a promise resolving the response.
 */
async function sendHop(
  url: URL,
  method: string,
  headers: OutgoingHttpHeaders,
  body: string | null,
  verify: boolean,
  proxy: string | null,
  signal: AbortSignal,
): Promise<IncomingMessage> {
  const secure: boolean = url.protocol === 'https:';
  const port: number = Number(url.port) || DEFAULT_PORTS[url.protocol];
  const hostname: string = url.hostname.replace(/^\[|\]$/g, '');
  const options: RequestOptions & { rejectUnauthorized?: boolean } = {
    method,
    headers,
    hostname,
    port,
    path: `${url.pathname}${url.search}`,
  };
  if (secure) {
    options.rejectUnauthorized = verify;
  }
  // A listener added below hears nothing of an abort that has already happened, which is what one
  // landing between redirect hops, or before the send began, would be.
  signal.throwIfAborted();
  if (proxy !== null && secure) {
    const tunnel: Socket = await openTunnel(proxy, hostname, port, signal);
    options.agent = false;
    options.createConnection = (): Socket =>
      tlsConnect({
        socket: tunnel,
        servername: hostname,
        rejectUnauthorized: verify,
      });
  } else if (proxy !== null) {
    const [proxyHost, proxyPort]: string[] = proxy.split(':');
    options.hostname = proxyHost;
    options.port = Number(proxyPort) || DEFAULT_PORTS['http:'];
    options.path = url.href;
    options.headers = { host: url.host, ...headers };
  }
  return new Promise<IncomingMessage>(
    (resolve: (response: IncomingMessage) => void, reject: (reason: unknown) => void): void => {
      // Over a tunnel the socket is TLS already, so the request itself is plain HTTP framing.
      const send: ClientRequest = (secure && proxy === null ? httpsRequest : httpRequest)(options);
      signal.addEventListener('abort', (): void => {
        send.destroy(signal.reason as Error);
      });
      send.once('response', resolve);
      send.once('error', reject);
      send.end(body ?? undefined);
    },
  );
}

/**
 * Picks the decompressor a response's encoding needs.
 * @param response The response.
 * @returns Returns the stream to read.
 */
function decoded(response: IncomingMessage): Readable {
  switch (response.headers['content-encoding']?.trim().toLowerCase()) {
    case 'gzip':
    case 'x-gzip':
      return response.pipe(createGunzip());
    case 'deflate':
      return response.pipe(createInflate());
    case 'br':
      return response.pipe(createBrotliDecompress());
    default:
      return response;
  }
}

/**
 * Reads a body up to a limit, leaving the rest unread.
 * @param response The response.
 * @param limit The most bytes to read.
 * @param signal Abandons the read.
 * @returns Returns a promise resolving what was read and whether it was cut.
 */
function readBody(
  response: IncomingMessage,
  limit: number,
  signal: AbortSignal,
): Promise<{ readonly body: Uint8Array; readonly truncated: boolean }> {
  return new Promise<{ readonly body: Uint8Array; readonly truncated: boolean }>(
    (
      resolve: (read: { readonly body: Uint8Array; readonly truncated: boolean }) => void,
      reject: (reason: unknown) => void,
    ): void => {
      const stream: Readable = decoded(response);
      const chunks: Buffer[] = [];
      let length: number = 0;
      signal.addEventListener('abort', (): void => {
        response.destroy(signal.reason as Error);
        reject(signal.reason as Error);
      });
      stream.on('data', (chunk: Buffer): void => {
        chunks.push(chunk);
        length += chunk.byteLength;
        if (length >= limit) {
          resolve({ body: Buffer.concat(chunks).subarray(0, limit), truncated: length > limit });
          response.destroy();
        }
      });
      stream.once('end', (): void => resolve({ body: Buffer.concat(chunks), truncated: false }));
      stream.once('error', reject);
    },
  );
}

/**
 * Flattens response headers the way fetch reports them: repeats joined with a comma.
 * @param response The response.
 * @returns Returns the headers.
 */
function flatHeaders(response: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(response.headers)) {
    if (value !== undefined) {
      headers[name] = Array.isArray(value) ? value.join(', ') : value;
    }
  }
  return headers;
}

/**
 * Builds the transport the API Explorer sends through: Node's own client rather than fetch, because
 * only it can be told per request to accept a certificate or go through a proxy.
 * @param system Asks the system how a URL is reached.
 * @returns Returns the transport.
 */
export function createApiTransport(system: SystemProxyResolver): ApiTransport {
  return async (request: TransportRequest): Promise<TransportResponse> => {
    const started: number = performance.now();
    let hop: Pick<TransportRequest, 'method' | 'url' | 'headers' | 'body'> = request;
    let wasRedirected: boolean = false;
    for (let hops: number = 0; ; hops += 1) {
      const url: URL = new URL(hop.url);
      if (!WEB_SCHEMES.has(url.protocol)) {
        throw new Error(`Refused to send a request to ${url.protocol}`);
      }
      const verify: boolean =
        request.acceptSelfSigned === 'never' ||
        (request.acceptSelfSigned === 'localhost' && !isLocalHost(url.hostname));
      const response: IncomingMessage = await sendHop(
        url,
        hop.method,
        withDefaults(hop.headers),
        hop.body,
        verify,
        await proxyFor(url, request.proxy, system),
        request.signal,
      );
      const status: number = response.statusCode ?? 0;
      const location: string | undefined = response.headers.location;
      if (REDIRECT_STATUSES.has(status) && location !== undefined && request.followRedirects) {
        response.resume();
        if (hops >= MAX_REDIRECTS) {
          throw new Error(`Stopped after ${MAX_REDIRECTS} redirects`);
        }
        hop = redirected(hop, status, new URL(location, url).href);
        wasRedirected = true;
        continue;
      }
      const firstByteMs: number = performance.now() - started;
      const read: { readonly body: Uint8Array; readonly truncated: boolean } = await readBody(
        response,
        request.maxBodyBytes,
        request.signal,
      );
      const stated: number = Number(response.headers['content-length']);
      return {
        status,
        statusText: response.statusMessage ?? '',
        headers: flatHeaders(response),
        body: read.body,
        sizeBytes: Number.isFinite(stated) && stated > 0 ? stated : read.body.byteLength,
        truncated: read.truncated,
        finalUrl: hop.url,
        redirected: wasRedirected,
        firstByteMs,
      };
    }
  };
}
