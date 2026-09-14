import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { ArchiveProvision, everyPlatform, platformKey } from './archive-provision';
import {
  ArchiveProvisioner,
  installedVersions,
  isComplete,
  markComplete,
  pruneVersions,
} from './archive-provisioner';

/**
 * Builds a provision whose single archive serves every platform, so the tests do not depend on which
 * machine runs them.
 * @returns Returns the provision.
 */
function provision(): ArchiveProvision {
  return everyPlatform('demo', '1.0.0', {
    url: 'https://example.invalid/demo.tar.gz',
    sha256: 'f'.repeat(64),
    archive: 'tar.gz',
    executablePath: 'bin/demo',
  });
}

describe('ArchiveProvisioner', () => {
  let root: string;
  let provisioner: ArchiveProvisioner;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'studio-archive-'));
    provisioner = new ArchiveProvisioner(root, 'Test');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /**
   * Creates the install directory a provision would produce.
   * @returns Returns the directory path.
   */
  function installDirectory(): string {
    const directory: string = path.join(root, 'demo', '1.0.0', platformKey());
    mkdirSync(directory, { recursive: true });
    return directory;
  }

  it('directoryOf_scopesTheInstallByIdVersionAndPlatform', () => {
    expect(provisioner.directoryOf(provision())).toBe(
      path.join(root, 'demo', '1.0.0', platformKey()),
    );
  });

  it('targetOf_appendsTheEntryPointFromTheRecipe', () => {
    expect(provisioner.targetOf(provision())).toBe(
      path.join(root, 'demo', '1.0.0', platformKey(), 'bin', 'demo'),
    );
  });

  it('isInstalled_freshRoot_isFalse', () => {
    expect(provisioner.isInstalled(provision())).toBe(false);
  });

  it('isInstalled_directoryWithoutTheExecutable_isFalse', () => {
    // An interrupted download leaves the directory behind; a directory is not an install.
    installDirectory();

    expect(provisioner.isInstalled(provision())).toBe(false);
  });

  it('isInstalled_executableWithoutTheMarker_isFalse', () => {
    // The half-finished case that mattered: the file is there, but the install never completed, so it
    // must not be reported as ready and then fail at the point of use.
    const directory: string = installDirectory();
    mkdirSync(path.join(directory, 'bin'), { recursive: true });
    writeFileSync(path.join(directory, 'bin', 'demo'), '#!/bin/sh\n');

    expect(provisioner.isInstalled(provision())).toBe(false);
  });

  it('isInstalled_markerWithoutTheExecutable_isFalse', async () => {
    const directory: string = installDirectory();
    await markComplete(directory);

    expect(provisioner.isInstalled(provision())).toBe(false);
  });

  it('isInstalled_markerAndExecutable_isTrue', async () => {
    const directory: string = installDirectory();
    mkdirSync(path.join(directory, 'bin'), { recursive: true });
    writeFileSync(path.join(directory, 'bin', 'demo'), '#!/bin/sh\n');
    await markComplete(directory);

    expect(provisioner.isInstalled(provision())).toBe(true);
  });

  it('remove_deletesTheInstallDirectory', async () => {
    const directory: string = installDirectory();
    await markComplete(directory);
    await provisioner.remove(provision());

    expect(existsSync(directory)).toBe(false);
  });

  it('remove_isNotAnErrorWhenNothingIsInstalled', async () => {
    await expect(provisioner.remove(provision())).resolves.toBeUndefined();
  });

  it('ensure_unreachableUrl_reportsFailureAndLeavesNoInstall', async () => {
    // A failed download must not leave a directory that later reads as installed.
    const result: string | null = await provisioner.ensure(provision());

    expect(result).toBeNull();
    expect(provisioner.isInstalled(provision())).toBe(false);
  });

  it('ensure_afterAFailure_downloadsAgainRatherThanAnsweringFromTheCache', async () => {
    // The cache exists so racing callers share one download, not so one failure becomes permanent. When
    // a null was cached, a plugin whose payload was briefly unreachable could not be installed again
    // without restarting Studio — the Install button reported the same failure without a request going
    // out. See the same fix in `LockfileProvisioner`, which is where #697 found it.
    let attempts: number = 0;
    vi.stubGlobal('fetch', (): Promise<Response> => {
      attempts += 1;
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    try {
      expect(await provisioner.ensure(provision())).toBeNull();
      expect(await provisioner.ensure(provision())).toBeNull();

      expect(attempts).toBe(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('disabledProvisioning_installsNothing', async () => {
    const disabled: ArchiveProvisioner = new ArchiveProvisioner(null, 'Test');

    expect(disabled.directoryOf(provision())).toBeNull();
    expect(disabled.targetOf(provision())).toBeNull();
    expect(disabled.isInstalled(provision())).toBe(false);
    await expect(disabled.ensure(provision())).resolves.toBeNull();
  });

  it('unsupportedPlatform_installsNothing', async () => {
    const elsewhere: ArchiveProvision = {
      id: 'demo',
      version: '1.0.0',
      downloads: {
        'some-platform-that-is-not-this-one': {
          url: 'https://example.invalid/demo.tar.gz',
          sha256: 'f'.repeat(64),
          archive: 'tar.gz',
          executablePath: 'bin/demo',
        },
      },
    };

    expect(provisioner.directoryOf(elsewhere)).toBeNull();
    await expect(provisioner.ensure(elsewhere)).resolves.toBeNull();
  });

  it('isComplete_reflectsTheMarker', async () => {
    const directory: string = installDirectory();

    expect(isComplete(directory)).toBe(false);
    await markComplete(directory);
    expect(isComplete(directory)).toBe(true);
  });

  describe('pruneVersions', () => {
    /**
     * Creates an install directory for a version.
     * @param version The version to create.
     * @returns Returns the directory path.
     */
    function versionDirectory(version: string): string {
      const directory: string = path.join(root, 'demo', version, platformKey());
      mkdirSync(directory, { recursive: true });
      writeFileSync(path.join(directory, 'file'), 'x');
      return directory;
    }

    it('removesTheVersionsAnUpdateSupersedes', async () => {
      // What makes an update a replacement rather than an accumulation.
      versionDirectory('1.0.0');
      versionDirectory('2.0.0');

      await pruneVersions(root, 'demo', '2.0.0', 'Test');

      expect(existsSync(path.join(root, 'demo', '1.0.0'))).toBe(false);
      expect(existsSync(path.join(root, 'demo', '2.0.0'))).toBe(true);
    });

    it('keepsEverythingWhenTheKeptVersionIsTheOnlyOne', async () => {
      versionDirectory('1.0.0');

      await pruneVersions(root, 'demo', '1.0.0', 'Test');

      expect(existsSync(path.join(root, 'demo', '1.0.0'))).toBe(true);
    });

    it('doesNothingForAComponentThatWasNeverInstalled', async () => {
      await expect(pruneVersions(root, 'absent', '1.0.0', 'Test')).resolves.toBeUndefined();
    });

    it('doesNothingWhenProvisioningIsDisabled', async () => {
      await expect(pruneVersions(null, 'demo', '1.0.0', 'Test')).resolves.toBeUndefined();
    });
  });
  describe('installedVersions', () => {
    /**
     * Creates an install directory for a version, optionally marked complete.
     * @param version The version to create.
     * @param complete Whether to write the completion marker.
     */
    function install(version: string, complete: boolean): void {
      const directory: string = path.join(root, 'demo', version, platformKey());
      mkdirSync(directory, { recursive: true });
      if (complete) {
        writeFileSync(path.join(directory, '.studio-install-complete'), 'x');
      }
    }

    it('readsTheVersionsOutOfTheLayoutWithNoRecordInvolved', () => {
      // The directory is the ground truth: a profile whose install record was forgotten as stale
      // (#463) still has this, which is what lets #456 heal rather than merely stop recurring.
      install('1.0.0', true);
      install('2.0.0', true);

      expect([...installedVersions(root, 'demo')].sort()).toEqual(['1.0.0', '2.0.0']);
    });

    it('ignoresAnInstallThatNeverCompleted', () => {
      // An interrupted download leaves a directory behind, and a directory is not an install.
      install('1.0.0', false);

      expect(installedVersions(root, 'demo')).toEqual([]);
    });

    it('findsNothingForAComponentThatWasNeverInstalled', () => {
      expect(installedVersions(root, 'absent')).toEqual([]);
    });

    it('findsNothingWhenProvisioningIsDisabled', () => {
      expect(installedVersions(null, 'demo')).toEqual([]);
    });
  });
});
