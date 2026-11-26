import { describe, expect, it } from 'vitest';
import { promisify } from 'node:util';
import type { RepositoryTrustDecision } from '@shared/api/source-control-channels';
import {
  Launcher,
  launcherForFolder,
  launchFor,
  launchStudioOwned,
  RunToken,
  RunTokens,
} from './launch';

/**
 * Issues tokens as a trust store with one decision for every folder would.
 * @param decision The decision.
 * @returns Returns the issuer.
 */
function tokensWhere(decision: RepositoryTrustDecision): RunTokens {
  return new RunTokens({ decisionFor: (): RepositoryTrustDecision => decision });
}

describe('run tokens (#1504)', () => {
  it('issuesATokenOnlyForATrustedFolder', () => {
    expect(tokensWhere('trusted').issue('/work/shop')?.folder).toBe('/work/shop');
    expect(tokensWhere('restricted').issue('/work/shop')).toBeNull();
    expect(tokensWhere('unknown').issue('/work/shop')).toBeNull();
  });

  it('refusesAForgedToken', () => {
    // Shaped like a token, made anywhere but the issuer: it starts nothing.
    const forged: RunToken = { folder: '/work/shop' };

    expect(() => launchFor(forged)).toThrow(/not issued for a trusted folder/);
  });

  it('opensTheDoor_forAnIssuedToken', () => {
    const token: RunToken = tokensWhere('trusted').issue('/work/shop')!;

    expect(typeof launchFor(token).spawn).toBe('function');
  });

  it('keepsExecFilesPromiseForm_soStdoutIsStillRead', async () => {
    const run: (file: string, args: readonly string[]) => Promise<{ stdout: string }> = promisify(
      launchStudioOwned('tool-probe').execFile,
    );

    const { stdout } = await run(process.execPath, ['-e', 'process.stdout.write("hello")']);

    expect(stdout).toBe('hello');
  });

  describe('a folder the user starts something in', () => {
    const scope: { isWithin(target: unknown): boolean } = {
      isWithin: (target: unknown): boolean => String(target).startsWith('/work/'),
    };

    it('outsideEveryWorkspace_isTheUsersOwn', () => {
      expect(
        launcherForFolder(scope, tokensWhere('unknown'), '/Users/me', 'user-terminal'),
      ).not.toBeNull();
    });

    it('inAWorkspaceNotTrusted_getsNoLauncher', () => {
      expect(
        launcherForFolder(scope, tokensWhere('unknown'), '/work/shop', 'user-terminal'),
      ).toBeNull();
    });

    it('inATrustedWorkspace_getsItsTokensLauncher', () => {
      const launch: Launcher | null = launcherForFolder(
        scope,
        tokensWhere('trusted'),
        '/work/shop',
        'user-terminal',
      );

      expect(launch).not.toBeNull();
    });
  });
});
