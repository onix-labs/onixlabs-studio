// The NuGet plugin's entry point: serves the package-manager protocol over standard streams (#910).
//
// Studio spawns this once per session and keeps it running. Each line on stdin is one request; each
// answer goes back as one line on stdout carrying the request's `id`. Requests are handled as they
// arrive, because a solution with hundreds of packages must not hold up a search — Studio correlates
// answers by `id`, so their order does not matter.
import { createInterface, Interface } from 'node:readline';
import { CredentialAsk, HttpFetch, HttpResponse } from './protocol';
import { note } from './log';
import { NuGetEndpointHandler, NuGetRequest } from './handler';

/**
 * Specifies how long one feed request may take, so one dead feed costs a lookup and not a load.
 */
const REGISTRY_TIMEOUT_MS: number = 30_000;

/**
 * Holds the credential asks awaiting Studio's answer, keyed by correlation identifier.
 */
const asks: Map<number, (token: string | null) => void> = new Map<
  number,
  (token: string | null) => void
>();

/**
 * Holds the next credential ask's correlation identifier.
 */
let nextCall: number = 1;

/**
 * Writes one protocol message to stdout.
 * @param message The message.
 */
function send(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

/**
 * Asks Studio for a token saved for a feed, mid-request.
 * @param registry The feed.
 * @returns Returns the token, or null when Studio holds none or will not hand it over.
 */
const askStudio: CredentialAsk = (registry: string): Promise<string | null> =>
  new Promise<string | null>((resolve: (token: string | null) => void): void => {
    const callId: number = nextCall;
    nextCall += 1;
    asks.set(callId, resolve);
    send({ request: 'credential', callId, registry });
  });

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
const handler: NuGetEndpointHandler = new NuGetEndpointHandler(httpFetch, askStudio, process.env);

/**
 * Answers one line: Studio's answer to a credential ask, or a request.
 * @param line The line.
 */
async function handle(line: string): Promise<void> {
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    note('nuget', 'Ignored a line that is not JSON');
    return;
  }
  if (typeof message !== 'object' || message === null) {
    return;
  }
  const record: Record<string, unknown> = message as Record<string, unknown>;
  if (record['answer'] === 'credential') {
    const callId: unknown = record['callId'];
    const token: unknown = record['token'];
    if (typeof callId === 'number') {
      asks.get(callId)?.(typeof token === 'string' ? token : null);
      asks.delete(callId);
    }
    return;
  }
  if (typeof record['id'] !== 'number' || typeof record['op'] !== 'string') {
    note('nuget', 'Ignored a request with no id or operation');
    return;
  }
  send(await handler.handle(record as unknown as NuGetRequest));
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
