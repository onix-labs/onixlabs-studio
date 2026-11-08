// The vcpkg plugin's entry point: serves the package-manager protocol over standard streams (#917).
//
// Studio spawns this once per session and keeps it running. Each line on stdin is one request; each
// answer goes back as one line on stdout carrying the request's `id`. Requests are handled as they
// arrive — Studio correlates answers by `id`, so their order does not matter.
//
// vcpkg's built-in registry is public, so this plugin never asks Studio for a credential. A Git or
// folder registry is not read at all (see `manifest.ts`), so it never needs one either.
import { createInterface, Interface } from 'node:readline';
import { HttpFetch, HttpResponse } from './protocol';
import { note } from './log';
import { VcpkgEndpointHandler, VcpkgRequest } from './handler';
import { BaselineStore, DEFAULT_REGISTRY } from './registry';

/**
 * Specifies how long one registry request may take, so a dead network costs a lookup and not a load.
 */
const REGISTRY_TIMEOUT_MS: number = 30_000;

/**
 * Names the variable a contract spec points the registry at a fake with. Only a loopback address is
 * honoured, so it can never send the plugin anywhere real — and Studio's allow-listed plugin
 * environment does not pass it through in any case.
 */
const REGISTRY_OVERRIDE: string = 'STUDIO_VCPKG_REGISTRY_URL';

/**
 * Writes one protocol message to stdout.
 * @param message The message.
 */
function send(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

/**
 * Chooses where the built-in registry's files are read from: the public one, unless a spec set a
 * loopback fake.
 * @returns Returns the registry's base URL.
 */
function registryBase(): string {
  const override: string | undefined = process.env[REGISTRY_OVERRIDE];
  if (
    override !== undefined &&
    /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/.test(override)
  ) {
    return override;
  }
  return DEFAULT_REGISTRY;
}

/**
 * Fetches through the runtime's own fetch, with a time limit.
 * @param url The URL.
 * @param init The request's headers.
 * @returns Returns the response.
 */
const httpFetch: HttpFetch = (
  url: string,
  init?: { headers?: Record<string, string> },
): Promise<HttpResponse> =>
  fetch(url, { ...init, signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS) });

/**
 * The handler every request is answered by.
 */
const handler: VcpkgEndpointHandler = new VcpkgEndpointHandler(
  new BaselineStore(registryBase(), httpFetch),
);

/**
 * Answers one line.
 * @param line The line.
 */
async function handle(line: string): Promise<void> {
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    note('vcpkg', 'Ignored a line that is not JSON');
    return;
  }
  if (typeof message !== 'object' || message === null) {
    return;
  }
  const record: Record<string, unknown> = message as Record<string, unknown>;
  if (typeof record['id'] !== 'number' || typeof record['op'] !== 'string') {
    note('vcpkg', 'Ignored a request with no id or operation');
    return;
  }
  send(await handler.handle(record as unknown as VcpkgRequest));
}

/**
 * Reads the protocol from stdin.
 */
const lines: Interface = createInterface({ input: process.stdin });
lines.on('line', (line: string): void => {
  if (line.trim().length > 0) {
    void handle(line);
  }
});
// Studio closing stdin is how it says the session is over.
lines.on('close', (): void => {
  process.exit(0);
});
