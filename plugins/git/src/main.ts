// The Git plugin's entry point: serves the version-control protocol over standard streams (#817).
//
// Studio spawns this once per session and keeps it running. Each line on stdin is one request; each
// answer goes back as one line on stdout carrying the request's `id`. Requests are handled as they
// arrive rather than one at a time, because a fetch over a slow network must not hold up the status
// read a panel is waiting on — Studio correlates answers by `id`, so their order does not matter.
import { createInterface, Interface } from 'node:readline';
import { GitVersionControl } from './git';
import { note } from './log';
import {
  VersionControlExecutableChoice,
  VersionControlOp,
  VersionControlResponse,
  VcsParams,
} from './protocol';

/**
 * The git endpoint every request is answered by.
 */
const git: GitVersionControl = new GitVersionControl();

/**
 * Writes one response line to stdout.
 * @param response The response.
 */
function reply(response: VersionControlResponse): void {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

/**
 * Reads the executable choice out of an untrusted initialize request.
 * @param params The request's parameters.
 * @returns Returns the choice, or null for the git on the PATH.
 */
function executableOf(params: unknown): VersionControlExecutableChoice | null {
  const executable: unknown =
    typeof params === 'object' && params !== null
      ? (params as Record<string, unknown>)['executable']
      : null;
  if (typeof executable !== 'object' || executable === null) {
    return null;
  }
  const record: Record<string, unknown> = executable as Record<string, unknown>;
  return record['mode'] === 'custom' && typeof record['path'] === 'string'
    ? { mode: 'custom', path: record['path'] }
    : { mode: 'installed', path: '' };
}

/**
 * Answers one request line.
 * @param line The line.
 */
async function handle(line: string): Promise<void> {
  let request: unknown;
  try {
    request = JSON.parse(line);
  } catch {
    note('git', 'Ignored a line that is not JSON');
    return;
  }
  if (typeof request !== 'object' || request === null) {
    return;
  }
  const record: Record<string, unknown> = request as Record<string, unknown>;
  const id: unknown = record['id'];
  const op: unknown = record['op'];
  if (typeof id !== 'number' || typeof op !== 'string') {
    note('git', 'Ignored a request with no id or operation');
    return;
  }
  if (op === 'initialize') {
    reply({ id, ok: true, result: await git.start(executableOf(record['params'])) });
    return;
  }
  const root: unknown = record['root'];
  const response: VersionControlResponse = await git.request(
    op as VersionControlOp,
    typeof root === 'string' ? root : undefined,
    record['params'] as VcsParams<VersionControlOp>,
  );
  reply({ ...response, id });
}

const lines: Interface = createInterface({ input: process.stdin });
lines.on('line', (line: string): void => {
  if (line.trim().length > 0) {
    void handle(line);
  }
});
// Studio closing stdin is how it says the session is over.
lines.on('close', (): void => {
  git.dispose();
  process.exit(0);
});
