import { describe, expect, it } from 'vitest';
import { addCommand, Placement, removeCommand, restoreCommand } from './commands';
import type { PackageCommand } from './protocol';

/**
 * A crate's manifest, named by the fixtures.
 */
const MANIFEST: string = '/work/app/Cargo.toml';

describe('addCommand', () => {
  it('addCommand_newCrateWithAVersion_addsItToDependencies', () => {
    // Arrange
    const version: string = '1.0';

    // Act
    const command: PackageCommand = addCommand(MANIFEST, 'serde', version, 'Install serde', null);

    // Assert
    expect(command).toEqual({
      executable: 'cargo',
      args: ['add', 'serde@1.0', '--manifest-path', MANIFEST],
      cwd: '/work/app',
      title: 'Install serde',
    });
  });

  it('addCommand_existingDevTargetEntry_movesThatEntryInPlace', () => {
    // Arrange
    const placement: Placement = {
      table: 'dev-dependencies',
      target: 'cfg(unix)',
      key: 'nix',
      package: 'nix',
    };

    // Act
    const command: PackageCommand = addCommand(MANIFEST, 'nix', '0.29.0', 'Update nix', placement);

    // Assert
    expect(command.args).toEqual([
      'add',
      'nix@0.29.0',
      '--manifest-path',
      MANIFEST,
      '--dev',
      '--target',
      'cfg(unix)',
    ]);
  });

  it('addCommand_renamedEntry_namesTheCrateAndKeepsTheKey', () => {
    // Arrange
    const placement: Placement = {
      table: 'build-dependencies',
      target: null,
      key: 'json',
      package: 'serde_json',
    };

    // Act
    const command: PackageCommand = addCommand(
      MANIFEST,
      'json',
      '1.0.120',
      'Update json',
      placement,
    );

    // Assert
    expect(command.args).toEqual([
      'add',
      'serde_json@1.0.120',
      '--manifest-path',
      MANIFEST,
      '--build',
      '--rename',
      'json',
    ]);
  });

  it('addCommand_nameThatReadsAsAnOption_isRefused', () => {
    // Arrange
    const names: readonly string[] = ['--git=https://evil', '-Z', 'a b', 'serde;rm', ''];

    // Act
    const attempts: readonly (() => PackageCommand)[] = names.map(
      (name: string): (() => PackageCommand) =>
        (): PackageCommand =>
          addCommand(MANIFEST, name, null, 'Install', null),
    );

    // Assert
    for (const attempt of attempts) {
      expect(attempt).toThrow(/not a crate name/);
    }
  });

  it('addCommand_versionThatReadsAsAnOption_isRefused', () => {
    // Arrange
    const versions: readonly string[] = ['--locked', '1.0 --offline', 'latest', '1;ls'];

    // Act
    const attempts: readonly (() => PackageCommand)[] = versions.map(
      (version: string): (() => PackageCommand) =>
        (): PackageCommand =>
          addCommand(MANIFEST, 'serde', version, 'Install', null),
    );

    // Assert
    for (const attempt of attempts) {
      expect(attempt).toThrow(/not a version/);
    }
  });

  it('addCommand_requirementOperators_areAccepted', () => {
    // Arrange
    const versions: readonly string[] = ['^1.2', '=0.4.1', '~0.3', '>=1,<2', '1.0.0-rc.1'];

    // Act
    const specs: readonly string[] = versions.map(
      (version: string): string => addCommand(MANIFEST, 'serde', version, 'Install', null).args[1],
    );

    // Assert
    expect(specs).toEqual([
      'serde@^1.2',
      'serde@=0.4.1',
      'serde@~0.3',
      'serde@>=1,<2',
      'serde@1.0.0-rc.1',
    ]);
  });
});

describe('removeCommand', () => {
  it('removeCommand_buildDependency_removesItFromThatTable', () => {
    // Arrange
    const placement: Placement = {
      table: 'build-dependencies',
      target: null,
      key: 'cc',
      package: 'cc',
    };

    // Act
    const command: PackageCommand = removeCommand(MANIFEST, placement);

    // Assert
    expect(command).toEqual({
      executable: 'cargo',
      args: ['remove', 'cc', '--manifest-path', MANIFEST, '--build'],
      cwd: '/work/app',
      title: 'Remove cc',
    });
  });

  it('removeCommand_targetThatReadsAsAnOption_isRefused', () => {
    // Arrange
    const placement: Placement = {
      table: 'dependencies',
      target: '--config=x',
      key: 'cc',
      package: 'cc',
    };

    // Act
    const act: () => PackageCommand = (): PackageCommand => removeCommand(MANIFEST, placement);

    // Assert
    expect(act).toThrow(/not a target/);
  });
});

describe('restoreCommand', () => {
  it('restoreCommand_aManifest_fetchesItsWorkspace', () => {
    // Arrange
    const manifest: string = MANIFEST;

    // Act
    const command: PackageCommand = restoreCommand(manifest);

    // Assert
    expect(command).toEqual({
      executable: 'cargo',
      args: ['fetch', '--manifest-path', MANIFEST],
      cwd: '/work/app',
      title: 'Fetch crates',
    });
  });
});
