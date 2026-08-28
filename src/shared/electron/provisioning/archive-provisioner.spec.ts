import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { ArchiveProvision, everyPlatform, platformKey } from './archive-provision';
import { ArchiveProvisioner, isComplete, markComplete, pruneVersions } from './archive-provisioner';

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
});
