// The GitHub plugin's entry point: serves the hosting protocol over standard streams (#820).
//
// Studio spawns this once per session and keeps it running. Each line on stdin is a request or an
// answer to a credential request this plugin made; each line on stdout is a response, carrying the
// request's `id`, or a credential request. Requests are handled as they arrive rather than one at a
// time — a slow listing must not hold up another panel's — and Studio correlates answers by `id`.
import { createInterface, Interface } from 'node:readline';
import { GitHubAuth, readGhToken } from './auth';
import { GitHubHosting, Http, HttpResponse, Outcome } from './github';
import { note } from './log';
import {
  HOSTING_PROTOCOL_VERSION,
  HostedRepositoryRef,
  HostingAuthMode,
  HostingCapability,
  HostingCredentialRequest,
  HostingDescription,
} from './protocol';

/**
 * The capabilities this plugin offers. Agent tools are not among them yet: how GitHub's tools reach
 * agents is decided with #836.
 */
const CAPABILITIES: readonly HostingCapability[] = [
  'accounts',
  'listRepositories',
  'createRepository',
  'pullRequests',
  'createPullRequest',
  'issues',
  'createIssue',
  'commentOnIssue',
  'setIssueState',
  'subIssues',
  'ciRuns',
  'ciRerun',
  'ciCancel',
];

/**
 * Holds the credential requests awaiting Studio's answer, keyed by call id.
 */
const waiting: Map<number, (token: string | null) => void> = new Map<
  number,
  (token: string | null) => void
>();

/**
 * Holds the next credential call id.
 */
let nextCallId: number = 1;

/**
 * Writes one message to stdout.
 * @param message The message.
 */
function write(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

/**
 * Asks Studio for the token it keeps for a host.
 * @param host The host.
 * @returns Returns the token, or null when Studio has none or will not hand it over.
 */
function askStudio(host: string): Promise<string | null> {
  const callId: number = nextCallId;
  nextCallId += 1;
  return new Promise<string | null>((resolve): void => {
    waiting.set(callId, resolve);
    const request: HostingCredentialRequest = { request: 'credential', callId, host };
    write(request);
  });
}

/**
 * Adapts the platform fetch to the client's seam.
 */
const http: Http = async (url, init): Promise<HttpResponse> => {
  const response: Response = await fetch(url, init);
  return {
    ok: response.ok,
    status: response.status,
    json: (): Promise<unknown> => response.json(),
    header: (name: string): string | null => response.headers.get(name),
  };
};

const auth: GitHubAuth = new GitHubAuth(readGhToken, askStudio);
const github: GitHubHosting = new GitHubHosting(http, auth);

/**
 * Reads a property of an untrusted record.
 * @param value The record.
 * @param key The property.
 * @returns Returns the property's value, or undefined.
 */
function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

/**
 * Reads a repository out of an untrusted request's parameters.
 * @param params The parameters.
 * @returns Returns the repository, or null when there is none.
 */
function repositoryOf(params: unknown): HostedRepositoryRef | null {
  const repository: unknown = field(params, 'repository');
  const host: unknown = field(repository, 'host');
  const owner: unknown = field(repository, 'owner');
  const name: unknown = field(repository, 'name');
  return typeof host === 'string' && typeof owner === 'string' && typeof name === 'string'
    ? { host: host.toLowerCase(), owner, name }
    : null;
}

/**
 * Reads the sign-in choices out of an untrusted initialize request.
 * @param params The parameters.
 * @returns Returns the choices by host.
 */
function choicesOf(params: unknown): Readonly<Record<string, HostingAuthMode>> {
  const raw: unknown = field(params, 'auth');
  const choices: Record<string, HostingAuthMode> = {};
  if (typeof raw === 'object' && raw !== null) {
    for (const [host, mode] of Object.entries(raw as Record<string, unknown>)) {
      if (mode === 'cli' || mode === 'studio') {
        choices[host.toLowerCase()] = mode;
      }
    }
  }
  return choices;
}

/**
 * Answers one operation.
 * @param op The operation.
 * @param params Its untrusted parameters.
 * @returns Returns the outcome.
 */
async function answer(op: string, params: unknown): Promise<Outcome<unknown>> {
  if (op === 'initialize') {
    auth.configure(choicesOf(params));
    const description: HostingDescription = {
      protocol: HOSTING_PROTOCOL_VERSION,
      capabilities: CAPABILITIES,
    };
    return { ok: true, result: description };
  }
  const host: unknown = field(params, 'host');
  const repository: HostedRepositoryRef | null = repositoryOf(params);
  const account: unknown = field(params, 'account');
  switch (op) {
    case 'authStatus':
      return typeof host === 'string' ? github.authStatus(host.toLowerCase()) : malformed(op);
    case 'listAccounts':
      return typeof host === 'string' ? github.listAccounts(host.toLowerCase()) : malformed(op);
    case 'listRepositories':
      return typeof host === 'string' && typeof account === 'string'
        ? github.listRepositories(host.toLowerCase(), account)
        : malformed(op);
    case 'listStarredRepositories':
      return typeof host === 'string'
        ? github.listStarredRepositories(host.toLowerCase())
        : malformed(op);
    case 'createRepository': {
      const name: unknown = field(params, 'name');
      const description: unknown = field(params, 'description');
      return typeof host === 'string' && typeof account === 'string' && typeof name === 'string'
        ? github.createRepository(
            host.toLowerCase(),
            account,
            name,
            field(params, 'private') === true,
            typeof description === 'string' ? description : undefined,
          )
        : malformed(op);
    }
    case 'listAgentTools':
      return { ok: true, result: [] };
    case 'invokeAgentTool':
      return { ok: false, error: 'GitHub offers no agent tools yet.', code: 'unsupported' };
    default:
      break;
  }
  if (repository === null) {
    return malformed(op);
  }
  const issue: unknown = field(params, 'issue');
  const runId: unknown = field(params, 'runId');
  switch (op) {
    case 'describeRepository':
      return github.describeRepository(repository);
    case 'listPullRequests':
      return github.listPullRequests(repository);
    case 'listIssues':
      return github.listIssues(repository);
    case 'listIssueComments':
      return typeof issue === 'number'
        ? github.listIssueComments(repository, issue)
        : malformed(op);
    case 'listSubIssues':
      return typeof issue === 'number' ? github.listSubIssues(repository, issue) : malformed(op);
    case 'listCiRuns':
      return github.listCiRuns(repository);
    case 'rerunCiRun':
      return typeof runId === 'string'
        ? github.runCommand(repository, runId, 'rerun')
        : malformed(op);
    case 'cancelCiRun':
      return typeof runId === 'string'
        ? github.runCommand(repository, runId, 'cancel')
        : malformed(op);
    case 'createIssue': {
      const title: unknown = field(params, 'title');
      const body: unknown = field(params, 'body');
      return typeof title === 'string' && (body === undefined || typeof body === 'string')
        ? github.createIssue(repository, title, body)
        : malformed(op);
    }
    case 'commentOnIssue': {
      const body: unknown = field(params, 'body');
      return typeof issue === 'number' && typeof body === 'string'
        ? github.commentOnIssue(repository, issue, body)
        : malformed(op);
    }
    case 'setIssueState': {
      const state: unknown = field(params, 'state');
      const reason: unknown = field(params, 'reason');
      return typeof issue === 'number' &&
        (state === 'open' || state === 'closed') &&
        (reason === undefined || reason === 'completed' || reason === 'notPlanned')
        ? github.setIssueState(repository, issue, state, reason)
        : malformed(op);
    }
    case 'createPullRequest': {
      const title: unknown = field(params, 'title');
      const head: unknown = field(params, 'head');
      const base: unknown = field(params, 'base');
      const body: unknown = field(params, 'body');
      const draft: unknown = field(params, 'draft');
      return typeof title === 'string' &&
        typeof head === 'string' &&
        typeof base === 'string' &&
        (body === undefined || typeof body === 'string')
        ? github.createPullRequest(repository, {
            title,
            head,
            base,
            ...(typeof body === 'string' ? { body } : {}),
            draft: draft === true,
          })
        : malformed(op);
    }
    default:
      return { ok: false, error: `GitHub does not answer ${op}.`, code: 'unsupported' };
  }
}

/**
 * Builds the failure for a request whose parameters are not what the operation needs.
 * @param op The operation.
 * @returns Returns the failure.
 */
function malformed(op: string): Outcome<never> {
  return { ok: false, error: `${op} was sent without the parameters it needs.`, code: 'refused' };
}

/**
 * Handles one line: an answer to a credential request, or a request to answer.
 * @param line The line.
 */
async function handle(line: string): Promise<void> {
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    note('github', 'Ignored a line that is not JSON');
    return;
  }
  if (field(message, 'answer') === 'credential') {
    const callId: unknown = field(message, 'callId');
    const token: unknown = field(message, 'token');
    const resolve: ((token: string | null) => void) | undefined =
      typeof callId === 'number' ? waiting.get(callId) : undefined;
    if (resolve !== undefined) {
      waiting.delete(callId as number);
      resolve(typeof token === 'string' ? token : null);
    }
    return;
  }
  const id: unknown = field(message, 'id');
  const op: unknown = field(message, 'op');
  if (typeof id !== 'number' || typeof op !== 'string') {
    note('github', 'Ignored a request with no id or operation');
    return;
  }
  let outcome: Outcome<unknown>;
  try {
    outcome = await answer(op, field(message, 'params'));
  } catch (error: unknown) {
    note('github', `${op} failed`, error);
    outcome = { ok: false, error: error instanceof Error ? error.message : 'GitHub failed.' };
  }
  write({ id, ...outcome });
}

const lines: Interface = createInterface({ input: process.stdin });
lines.on('line', (line: string): void => {
  if (line.trim().length > 0) {
    void handle(line);
  }
});
// Studio closing stdin is how it says the session is over.
lines.on('close', (): void => {
  for (const resolve of waiting.values()) {
    resolve(null);
  }
  process.exit(0);
});
