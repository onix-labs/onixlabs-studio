import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { addPortCommand, installCommand } from './commands';
import type { PackageCommand } from './protocol';

/**
 * A manifest's absolute path.
 */
const MANIFEST: string = path.resolve('/work/app/vcpkg.json');

describe('addPortCommand', () => {
  it('addPortCommand_aPort_isVcpkgAddPortInTheManifestFolder', () => {
    // Arrange
    const name: string = 'fmt';

    // Act
    const command: PackageCommand = addPortCommand(MANIFEST, name, null);

    // Assert
    expect(command).toEqual({
      executable: 'vcpkg',
      args: ['add', 'port', 'fmt'],
      cwd: path.dirname(MANIFEST),
      title: 'Add fmt',
    });
  });

  it('addPortCommand_aVersion_isCheckedButNotPassed', () => {
    // Arrange
    const version: string = '12.2.0#1';

    // Act
    const command: PackageCommand = addPortCommand(MANIFEST, 'fmt', version);

    // Assert
    expect(command.args).toEqual(['add', 'port', 'fmt']);
  });

  it('addPortCommand_aNameThatReadsAsAnOption_isRefused', () => {
    // Arrange
    const names: readonly string[] = [
      '--overlay-ports=/tmp',
      '-x',
      'fmt[core]',
      'fmt;rm',
      'Fmt',
      '',
    ];

    // Act
    const attempts: readonly (() => PackageCommand)[] = names.map(
      (name: string): (() => PackageCommand) =>
        (): PackageCommand =>
          addPortCommand(MANIFEST, name, null),
    );

    // Assert
    for (const attempt of attempts) {
      expect(attempt).toThrow(/not a vcpkg port name/);
    }
  });

  it('addPortCommand_aVersionThatReadsAsAnOption_isRefused', () => {
    // Arrange
    const version: string = '--triplet=x';

    // Act
    const attempt: () => PackageCommand = (): PackageCommand =>
      addPortCommand(MANIFEST, 'fmt', version);

    // Assert
    expect(attempt).toThrow(/not a version/);
  });

  it('addPortCommand_aProjectThatIsNotAManifest_isRefused', () => {
    // Arrange
    const project: string = path.resolve('/work/app/CMakeLists.txt');

    // Act
    const attempt: () => PackageCommand = (): PackageCommand =>
      addPortCommand(project, 'fmt', null);

    // Assert
    expect(attempt).toThrow(/vcpkg\.json/);
  });
});

describe('installCommand', () => {
  it('installCommand_aManifest_isVcpkgInstallInItsFolder', () => {
    // Arrange
    const project: string = MANIFEST;

    // Act
    const command: PackageCommand = installCommand(project);

    // Assert
    expect(command).toEqual({
      executable: 'vcpkg',
      args: ['install'],
      cwd: path.dirname(MANIFEST),
      title: 'Install vcpkg dependencies',
    });
  });
});
