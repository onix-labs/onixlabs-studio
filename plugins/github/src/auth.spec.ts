import { describe, expect, it } from 'vitest';
import { GitHubAuth, ResolvedCredential } from './auth';

/**
 * Builds a resolver over fixed answers, counting how often each source is asked.
 * @param cli The CLI's token, or null when it is signed out.
 * @param studio Studio's token, or null when it keeps none.
 * @param now The clock.
 * @returns Returns the resolver and the counts.
 */
function setup(
  cli: string | null,
  studio: string | null,
  now: () => number = () => 0,
): { auth: GitHubAuth; asked: { cli: number; studio: number } } {
  const asked: { cli: number; studio: number } = { cli: 0, studio: 0 };
  const auth: GitHubAuth = new GitHubAuth(
    () => {
      asked.cli += 1;
      return Promise.resolve(cli);
    },
    () => {
      asked.studio += 1;
      return Promise.resolve(studio);
    },
    now,
  );
  return { auth, asked };
}

describe('GitHubAuth', () => {
  it('byDefault_usesTheCliWhenItIsSignedIn_withoutAskingStudio', async () => {
    const { auth, asked } = setup('gho_cli', 'ghp_studio');

    const credential: ResolvedCredential | null = await auth.resolve('github.com');

    expect(credential).toEqual({ token: 'gho_cli', mode: 'cli' });
    expect(asked.studio).toBe(0);
  });

  it('byDefault_fallsBackToStudio_whenTheCliIsSignedOut', async () => {
    const { auth } = setup(null, 'ghp_studio');

    expect(await auth.resolve('github.com')).toEqual({ token: 'ghp_studio', mode: 'studio' });
  });

  it('whenTheUserChoseTheCli_neverAsksStudio', async () => {
    const { auth, asked } = setup(null, 'ghp_studio');
    auth.configure({ 'github.com': 'cli' });

    expect(await auth.resolve('github.com')).toBeNull();
    expect(asked.studio).toBe(0);
  });

  it('whenTheUserChoseStudio_neverAsksTheCli', async () => {
    const { auth, asked } = setup('gho_cli', 'ghp_studio');
    auth.configure({ 'github.com': 'studio' });

    expect(await auth.resolve('github.com')).toEqual({ token: 'ghp_studio', mode: 'studio' });
    expect(asked.cli).toBe(0);
  });

  it('choosesPerHost', async () => {
    const { auth } = setup('gho_cli', 'ghp_studio');
    auth.configure({ 'ghe.example.com': 'studio' });

    expect((await auth.resolve('github.com'))?.mode).toBe('cli');
    expect((await auth.resolve('ghe.example.com'))?.mode).toBe('studio');
  });

  it('reusesTheClisAnswerForAMinute_ratherThanSpawningItEveryRequest', async () => {
    let now: number = 0;
    const { auth, asked } = setup('gho_cli', null, () => now);

    await auth.resolve('github.com');
    await auth.resolve('github.com');
    expect(asked.cli).toBe(1);

    now = 60_001;
    await auth.resolve('github.com');
    expect(asked.cli).toBe(2);
  });

  it('treatsAnEmptyStudioTokenAsNone', async () => {
    const { auth } = setup(null, '');

    expect(await auth.resolve('github.com')).toBeNull();
  });
});
