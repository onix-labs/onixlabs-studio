// How the GitHub plugin signs in to a host (#819, #820).
//
// The user chooses per host, in Settings: `cli` — the GitHub CLI's login, so Studio, the terminal and
// agents' own `gh` calls all act as one account — or `studio`, a token Studio keeps in its encrypted
// store and hands over when asked. With no choice made, the CLI is used when it is signed in and
// Studio's token otherwise.
//
// Knowing about `gh` is this plugin's business: core used to run `gh auth token` itself, which made it
// know about GitHub's CLI. Now it knows nothing about it.
import { execFile } from 'node:child_process';
import { HostingAuthMode } from './protocol';
import { debug } from './log';

/**
 * How long `gh auth token` is given before it is abandoned. The CLI can block on a keychain prompt.
 */
const GH_TIMEOUT_MS: number = 3_000;

/**
 * How long a token read from `gh` is reused before the CLI is asked again. Asking spawns a process,
 * and a panel polling every few seconds would spawn one each time; a minute still notices a
 * `gh auth logout` promptly.
 */
const GH_CACHE_MS: number = 60_000;

/**
 * Describes a credential and how it was obtained.
 */
export interface ResolvedCredential {
  /**
   * Gets the token.
   */
  readonly token: string;

  /**
   * Gets how it was obtained.
   */
  readonly mode: HostingAuthMode;
}

/**
 * Reads the token the GitHub CLI holds for a host, or null when the CLI is absent, signed out or slow.
 */
export type CliTokenReader = (host: string) => Promise<string | null>;

/**
 * Asks Studio for the token it keeps for a host, or null when it keeps none.
 */
export type StudioTokenReader = (host: string) => Promise<string | null>;

/**
 * Resolves the credential for each host by the user's choice.
 */
export class GitHubAuth {
  /**
   * Holds the user's choice per host; a host absent from it uses the default.
   */
  private choices: Readonly<Record<string, HostingAuthMode>> = {};

  /**
   * Holds the tokens recently read from the CLI, with when they were read.
   */
  private readonly cliTokens: Map<string, { readonly token: string | null; readonly at: number }> =
    new Map<string, { token: string | null; at: number }>();

  /**
   * Initializes the resolver.
   * @param cli Reads the CLI's token.
   * @param studio Asks Studio for its token.
   * @param now Gets the current time in milliseconds.
   */
  public constructor(
    private readonly cli: CliTokenReader,
    private readonly studio: StudioTokenReader,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Records the user's choice per host, from the handshake.
   * @param choices The choices.
   */
  public configure(choices: Readonly<Record<string, HostingAuthMode>>): void {
    this.choices = choices;
    this.cliTokens.clear();
  }

  /**
   * Resolves the credential for a host.
   * @param host The host.
   * @returns Returns the credential and how it was obtained, or null when there is none.
   */
  public async resolve(host: string): Promise<ResolvedCredential | null> {
    const choice: HostingAuthMode | undefined = this.choices[host];
    if (choice !== 'studio') {
      const token: string | null = await this.cliToken(host);
      if (token !== null) {
        return { token, mode: 'cli' };
      }
      if (choice === 'cli') {
        return null;
      }
    }
    const token: string | null = await this.studio(host);
    return token === null || token.length === 0 ? null : { token, mode: 'studio' };
  }

  /**
   * Gets the CLI's token for a host, from the cache while it is fresh.
   * @param host The host.
   * @returns Returns the token, or null.
   */
  private async cliToken(host: string): Promise<string | null> {
    const cached: { token: string | null; at: number } | undefined = this.cliTokens.get(host);
    if (cached !== undefined && this.now() - cached.at < GH_CACHE_MS) {
      return cached.token;
    }
    const token: string | null = await this.cli(host);
    this.cliTokens.set(host, { token, at: this.now() });
    debug('auth', `gh ${token === null ? 'has no' : 'has a'} login for ${host}`);
    return token;
  }
}

/**
 * Reads the token the GitHub CLI holds for a host.
 *
 * `gh auth token` is asked for its *resolved* token, which is the point of going through the CLI rather
 * than reading its config: it knows about hosts, enterprise instances and keychain storage. The
 * environment is scrubbed of `GITHUB_TOKEN` and `GH_TOKEN` first — `gh` prefers an environment token
 * over a real login and reports it even when it is stale, a common state on a developer machine.
 * @param host The host.
 * @returns Returns the CLI's token, or null when the CLI is absent, not signed in, or too slow.
 */
export function readGhToken(host: string): Promise<string | null> {
  const environment: NodeJS.ProcessEnv = { ...process.env };
  delete environment['GITHUB_TOKEN'];
  delete environment['GH_TOKEN'];
  return new Promise<string | null>((resolve): void => {
    execFile(
      'gh',
      ['auth', 'token', '--hostname', host],
      { encoding: 'utf8', timeout: GH_TIMEOUT_MS, env: environment },
      (error: Error | null, stdout: string): void => {
        // Not installed, not signed in, or timed out. All three mean the same here: no CLI token.
        const token: string = error === null ? stdout.trim() : '';
        resolve(token.length === 0 ? null : token);
      },
    );
  });
}
