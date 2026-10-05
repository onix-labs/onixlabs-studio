import { describe, expect, it } from 'vitest';
import type { SetupProbeResult } from '@shared/api/setup-channels';
import { runSetupProbes } from './setup-probes';

/**
 * The probes run real processes against the machine the suite runs on, so what they find differs
 * between a developer's laptop and a CI runner. The assertions are therefore about the shape and the
 * contract — every probe answers, nothing throws, nothing hangs — rather than about which tools
 * happen to be installed, which is not a property of the code.
 */
describe('runSetupProbes', () => {
  it('answersForEveryToolchainProbe_butNotGit', async () => {
    // Git's rows come from the installed version-control plugin (#817), not from core.
    const results: readonly SetupProbeResult[] = await runSetupProbes(process.env);

    expect(results.map((result: SetupProbeResult): string => result.id).sort()).toEqual([
      'clangd',
      'dotnet',
      'go',
      'java',
      'node',
      'python',
      'rust',
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
