import * as childProcess from 'node:child_process';
import * as path from 'node:path';
import { promisify } from 'node:util';
import * as pty from 'node-pty';
import type { RepositoryTrustDecision } from '@shared/api/source-control-channels';
import { logger } from '../logger';

/**
 * The one place the main process starts a program (#1504). Matthew's railway token: a repository is a
 * train, anything that could run its code is a stretch of line, and trusting the folder hands over
 * the token. No token, no running.
 *
 * There are two doors, and no other: a spec fails the build if any other file starts a program.
 * - {@link launchFor} starts a program for a folder, and demands a {@link RunToken} for it. Only
 *   {@link RunTokens} issues one, and only for a folder the user has trusted, so code without a token
 *   has nothing to show, and a forged one is refused when it is presented.
 * - {@link launchStudioOwned} starts one of Studio's own programs, which acts on no repository: a
 *   plugin's process, the search tool, a version probe. It names why from a fixed list, so a reviewer
 *   sees the choice made.
 */

/**
 * A token for a folder the user trusts: what starting a program for that folder requires.
 */
export interface RunToken {
  /**
   * Gets the trusted folder the token was issued for.
   */
  readonly folder: string;
}

/**
 * Holds every token {@link RunTokens} issued. A token is checked against this when presented, so an
 * object shaped like one, made anywhere else, starts nothing.
 */
const issued: WeakSet<RunToken> = new WeakSet<RunToken>();

/**
 * The part of the trust store tokens are issued from.
 */
export interface TokenTrustSource {
  /**
   * Gets what the user decided about a folder.
   * @param target The folder.
   * @returns Returns the decision.
   */
  decisionFor(target: unknown): RepositoryTrustDecision;
}

/**
 * Issues run tokens: one for a folder the user has trusted, none otherwise.
 */
export class RunTokens {
  /**
   * Holds the trust store.
   */
  private readonly trust: TokenTrustSource;

  /**
   * Initializes a new instance of the {@link RunTokens} class.
   * @param trust The trust store.
   */
  public constructor(trust: TokenTrustSource) {
    this.trust = trust;
  }

  /**
   * Issues a token for a folder, when the user trusts it.
   * @param folder The absolute folder, or a file within it.
   * @returns Returns the token, or null when the folder is not trusted.
   */
  public issue(folder: string): RunToken | null {
    if (this.trust.decisionFor(folder) !== 'trusted') {
      return null;
    }
    const token: RunToken = Object.freeze({ folder: path.resolve(folder) });
    issued.add(token);
    return token;
  }
}

/**
 * Lists why one of Studio's own programs may start without a token: each acts on no repository.
 */
export type StudioOwnedReason =
  /** A plugin's own process, which Studio installed; its work for a folder is gated where it is sent. */
  | 'plugin-process'
  /** A harness's agent process, which Studio installed; a turn's folder trust travels with the turn. */
  | 'agent-harness'
  /** Reading the user's own shell environment, from their home folder. */
  | 'shell-environment'
  /** The bundled search tool, which reads files and runs nothing in them. */
  | 'search'
  /** A fixed `--version` or capability probe of a tool on the machine. */
  | 'tool-probe'
  /** Unpacking a download Studio verified, outside any workspace. */
  | 'download'
  /** Listing or stopping processes Studio started. */
  | 'process-control'
  /** The local model runtime Studio manages. */
  | 'model-runtime'
  /** A container or database engine's client, talking to the engine, not to a repository. */
  | 'engine-client'
  /** A code host's client (sign-in, its CLI), which acts on the host, not on a folder. */
  | 'hosting-client'
  /** A decoder, which parses bytes as data in a clean environment with no workspace folder. */
  | 'decoder'
  /** Machine statistics for the System Monitor. */
  | 'system-monitor'
  /** A language server's installer or its runtime probe, run from Studio's own folders. */
  | 'server-provisioning'
  /** A terminal the user opened outside every workspace, such as in their home folder. */
  | 'user-terminal';

/**
 * Starts programs, through one door or the other.
 */
export interface Launcher {
  /**
   * Starts a program, as Node's `spawn` does.
   */
  readonly spawn: typeof childProcess.spawn;

  /**
   * Runs a program, as Node's `execFile` does.
   */
  readonly execFile: typeof childProcess.execFile;

  /**
   * Runs a program to completion, as Node's `spawnSync` does.
   */
  readonly spawnSync: typeof childProcess.spawnSync;

  /**
   * Starts a program in a pseudo-terminal, as `node-pty`'s `spawn` does.
   */
  readonly pty: typeof pty.spawn;
}

/**
 * Builds a launcher that notes, at trace level, what it starts and on whose behalf.
 * @param behalf What the programs are started for, for the log.
 * @returns Returns the launcher.
 */
function launcher(behalf: string): Launcher {
  /**
   * Notes a program about to start.
   * @param file The program.
   */
  const note: (file: unknown) => void = (file: unknown): void => {
    logger.trace('launch', `Starting ${String(file)} for ${behalf}`);
  };
  return {
    spawn: ((...args: Parameters<typeof childProcess.spawn>): childProcess.ChildProcess => {
      note(args[0]);
      return childProcess.spawn(...args);
    }) as typeof childProcess.spawn,
    execFile: withPromisified(
      (...args: unknown[]): childProcess.ChildProcess => {
        note(args[0]);
        return (childProcess.execFile as (...all: unknown[]) => childProcess.ChildProcess)(...args);
      },
      (...args: unknown[]): Promise<unknown> => {
        note(args[0]);
        return (promisify(childProcess.execFile) as (...all: unknown[]) => Promise<unknown>)(
          ...args,
        );
      },
    ) as unknown as typeof childProcess.execFile,
    spawnSync: ((...args: unknown[]): unknown => {
      note(args[0]);
      return (childProcess.spawnSync as (...all: unknown[]) => unknown)(...args);
    }) as typeof childProcess.spawnSync,
    pty: (...args: Parameters<typeof pty.spawn>): pty.IPty => {
      note(args[0]);
      return pty.spawn(...args);
    },
  };
}

/**
 * Gives a wrapped `execFile` the promise form Node's own has. ⚠️ Node's `execFile` carries a custom
 * promisified form that resolves with `{ stdout, stderr }`; without it, `promisify` of a wrapper would
 * resolve with the output alone and every caller reading `stdout` would get undefined.
 * @param callback The wrapped callback form.
 * @param promised The wrapped promise form.
 * @returns Returns the callback form, carrying the promise form.
 */
function withPromisified(
  callback: (...args: unknown[]) => childProcess.ChildProcess,
  promised: (...args: unknown[]) => Promise<unknown>,
): (...args: unknown[]) => childProcess.ChildProcess {
  Object.defineProperty(callback, promisify.custom, { value: promised });
  return callback;
}

/**
 * Opens the door for a trusted folder: starts programs for it, given its token.
 * @param token The folder's token, as {@link RunTokens} issued it.
 * @returns Returns the launcher.
 * @throws Throws when the token was not issued by {@link RunTokens}.
 */
export function launchFor(token: RunToken): Launcher {
  if (!issued.has(token)) {
    throw new Error(
      'Refused to start a program: the run token was not issued for a trusted folder.',
    );
  }
  return launcher(token.folder);
}

/**
 * Opens the door for Studio's own programs, which act on no repository.
 * @param reason Why the program may start without a token.
 * @returns Returns the launcher.
 */
export function launchStudioOwned(reason: StudioOwnedReason): Launcher {
  return launcher(`Studio (${reason})`);
}

/**
 * Picks the door for a program the user starts in a folder of their choosing, such as a terminal: a
 * folder inside an open workspace needs that workspace's run token, and one outside every workspace
 * (their home folder) is their own.
 * @param scope The open workspaces.
 * @param tokens Issues run tokens.
 * @param folder The folder the program starts in.
 * @param ownReason Why a program outside every workspace may start without a token.
 * @returns Returns the launcher, or null when the folder is in a workspace the user has not trusted.
 */
export function launcherForFolder(
  scope: { isWithin(target: unknown): boolean },
  tokens: RunTokens,
  folder: string,
  ownReason: StudioOwnedReason,
): Launcher | null {
  if (!scope.isWithin(folder)) {
    return launchStudioOwned(ownReason);
  }
  const token: RunToken | null = tokens.issue(folder);
  return token === null ? null : launchFor(token);
}
