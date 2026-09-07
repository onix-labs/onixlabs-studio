import { describe, expect, it } from 'vitest';
import type { SetupProbeResult } from '@shared/api/setup-channels';
import { readGitIdentity, runSetupProbes } from './setup-probes';

/**
 * The probes run real processes against the machine the suite runs on, so what they find differs
 * between a developer's laptop and a CI runner. The assertions are therefore about the shape and the
 * contract — every probe answers, nothing throws, nothing hangs — rather than about which tools
 * happen to be installed, which is not a property of the code.
 */
describe('runSetupProbes', () => {
  it('answersForEveryProbe', async () => {
    const results: readonly SetupProbeResult[] = await runSetupProbes(process.env);

    expect(results.map((result: SetupProbeResult): string => result.id).sort()).toEqual([
      'clangd',
      'dotnet',
      'git',
      'git-identity',
      'java',
      'node',
    ]);
  });

  it('reportsAStatusAndAReadableDetailForEach', async () => {
    const results: readonly SetupProbeResult[] = await runSetupProbes(process.env);

    for (const result of results) {
      expect(['ok', 'warn', 'missing', 'unknown'], result.id).toContain(result.status);
      // A finding with no explanation is a finding the user cannot act on.
      expect(result.detail.length, result.id).toBeGreaterThan(0);
    }
  });

  it('findsNodeWhichIsRunningThisTest', async () => {
    // The one tool guaranteed present: it is executing the assertion.
    const results: readonly SetupProbeResult[] = await runSetupProbes(process.env);
    const node: SetupProbeResult | undefined = results.find(
      (result: SetupProbeResult): boolean => result.id === 'node',
    );

    expect(node?.status).toBe('ok');
    expect(node?.detail).toMatch(/^v\d+/);
  });

  it('reportsMissingRatherThanThrowing_whenNothingIsOnThePath', async () => {
    // An empty PATH is the extreme of the case this step exists for: Studio launched with an
    // environment that is not the user's. It must report, not crash.
    const results: readonly SetupProbeResult[] = await runSetupProbes({ PATH: '' });

    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(['missing', 'unknown'], result.id).toContain(result.status);
    }
  });
});

describe('readGitIdentity', () => {
  it('returnsBothFields_orNullWhenGitIsUnavailable', async () => {
    const identity: { name: string; email: string } | null = await readGitIdentity(process.env);

    if (identity !== null) {
      expect(typeof identity.name).toBe('string');
      expect(typeof identity.email).toBe('string');
    }
  });

  it('returnsNull_whenGitCannotBeRunAtAll', async () => {
    expect(await readGitIdentity({ PATH: '' })).toBeNull();
  });
});
