import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let userData: string = '';

vi.mock('electron', () => ({
  app: { getPath: (): string => userData },
}));

const { LspProvisioner, ROSLYN_VERSION, compareRoslynVersions, roslynBinaryCandidates } =
  await import('./lsp-provisioner');
const { markComplete } = await import('../provisioning/archive-provisioner');

/**
 * Gets the runtime identifier the provisioner resolves for the machine running the test.
 * @returns Returns the rid.
 */
function currentRid(): string {
  const arm: boolean = process.arch === 'arm64';
  const os: string =
    process.platform === 'darwin' ? 'osx' : process.platform === 'win32' ? 'win' : 'linux';
  return `${os}-${arm ? 'arm64' : 'x64'}`;
}

describe('compareRoslynVersions', () => {
  it('comparesEachPartAsAWholeNumber_so5Point13IsNewerThan5Point4', () => {
    // Not decimals: 5.13 is nine minor releases after 5.4.
    expect(compareRoslynVersions('5.13.0-1.26514.10', '5.4.0-2.26179.14')).toBeGreaterThan(0);
    expect(compareRoslynVersions('5.4.0-2.26179.14', '5.13.0-1.26514.10')).toBeLessThan(0);
    expect(compareRoslynVersions('5.13.0-1.26514.10', '5.13.0-1.26507.4')).toBeGreaterThan(0);
  });

  it('putsAReleaseAfterItsPrereleases_andTreatsEqualVersionsAsEqual', () => {
    expect(compareRoslynVersions('5.11.0', '5.11.0-1.26380.4')).toBeGreaterThan(0);
    expect(compareRoslynVersions('5.11.0-1.26380.4', '5.11.0')).toBeLessThan(0);
    expect(compareRoslynVersions('5.11.0', '5.11.0')).toBe(0);
  });
});

describe('roslynBinaryCandidates', () => {
  it('readsTheNugetLayoutFirst_thenTheOldVsImplLayout', () => {
    expect(roslynBinaryCandidates('osx-x64', false)).toEqual([
      path.join('osx-x64', 'tools', 'net10.0', 'osx-x64', 'Microsoft.CodeAnalysis.LanguageServer'),
      path.join(
        'osx-x64',
        'content',
        'LanguageServer',
        'osx-x64',
        'Microsoft.CodeAnalysis.LanguageServer',
      ),
    ]);
    expect(roslynBinaryCandidates('win-x64', true)[0]).toMatch(/LanguageServer\.exe$/);
  });
});

describe('LspProvisioner.installedRoslyn (#1135)', () => {
  const rid: string = currentRid();
  const windows: boolean = process.platform === 'win32';

  beforeEach(() => {
    userData = mkdtempSync(path.join(tmpdir(), 'studio-roslyn-'));
  });

  afterEach(() => {
    rmSync(userData, { recursive: true, force: true });
  });

  /**
   * Lays out a Roslyn install the way the provisioner does.
   * @param version The version directory.
   * @param layout Which package layout the binary is in (0 = nuget.org, 1 = vs-impl).
   * @param complete Whether the install finished (carries the completion marker).
   * @returns Returns the binary's path.
   */
  async function install(
    version: string,
    layout: 0 | 1,
    complete: boolean = true,
  ): Promise<string> {
    const versionDir: string = path.join(userData, 'lsp-servers', 'roslyn', version);
    const binary: string = path.join(versionDir, roslynBinaryCandidates(rid, windows)[layout]);
    mkdirSync(path.dirname(binary), { recursive: true });
    writeFileSync(binary, '');
    if (complete) {
      await markComplete(versionDir);
    }
    return binary;
  }

  it('isNull_whenNothingIsInstalled', () => {
    expect(new LspProvisioner().installedRoslyn()).toBeNull();
  });

  it('findsAnOlderInstallInTheOldLayout_soItKeepsWorkingUntilUpdated', async () => {
    const old: string = await install('5.4.0-2.26179.14', 1);

    expect(new LspProvisioner().installedRoslyn()).toBe(old);
  });

  it('prefersThePinnedVersion_overAnOlderOne', async () => {
    await install('5.4.0-2.26179.14', 1);
    const pinned: string = await install(ROSLYN_VERSION, 0);

    expect(new LspProvisioner().installedRoslyn()).toBe(pinned);
  });

  it('ignoresAnIncompleteInstall_andPrefersTheNewestOfOlderOnes', async () => {
    await install(ROSLYN_VERSION, 0, false);
    await install('5.4.0-2.26179.14', 1);
    const newer: string = await install('5.11.0', 0);

    expect(new LspProvisioner().installedRoslyn()).toBe(newer);
  });
});
