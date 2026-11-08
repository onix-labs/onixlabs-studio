import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { addCommand, CommandTarget, PythonTool, removeCommand, restoreCommand } from './commands';
import type { PackageCommand } from './protocol';

/**
 * The folder every target is in.
 */
const FOLDER: string = path.resolve('/work/app');

/**
 * Builds a target.
 * @param tool The tool.
 * @param file The manifest's file name.
 * @param extra Anything else to set.
 * @returns Returns the target.
 */
function target(
  tool: PythonTool | null,
  file: string = 'pyproject.toml',
  extra: Partial<CommandTarget> = {},
): CommandTarget {
  return { manifestPath: path.join(FOLDER, file), tool, locked: false, venv: null, ...extra };
}

describe('addCommand', () => {
  it.each<[PythonTool, readonly string[]]>([
    ['uv', ['add', 'requests==2.32.0']],
    ['poetry', ['add', 'requests==2.32.0']],
    ['pipenv', ['install', 'requests==2.32.0']],
  ])(
    'addCommand_%s_installsAnExactVersionInTheProjectsFolder',
    (tool: PythonTool, args: readonly string[]) => {
      // Act
      const command: PackageCommand = addCommand(
        target(tool),
        'requests',
        '2.32.0',
        { kind: 'main' },
        false,
      );

      // Assert
      expect(command).toEqual({ executable: tool, args, cwd: FOLDER, title: 'Install requests' });
    },
  );

  it('addCommand_anUpdateInAGroupOrExtra_keepsItThere', () => {
    // Act
    const uvGroup: PackageCommand = addCommand(
      target('uv'),
      'pytest',
      '8.3.0',
      { kind: 'group', group: 'test' },
      true,
    );
    const uvDev: PackageCommand = addCommand(
      target('uv'),
      'ruff',
      null,
      { kind: 'group', group: 'dev' },
      true,
    );
    const uvExtra: PackageCommand = addCommand(
      target('uv'),
      'pysocks',
      null,
      { kind: 'optional', extra: 'socks' },
      true,
    );
    const poetryGroup: PackageCommand = addCommand(
      target('poetry'),
      'pytest',
      null,
      { kind: 'group', group: 'test' },
      true,
    );
    const pipenvDev: PackageCommand = addCommand(
      target('pipenv', 'Pipfile'),
      'pytest',
      null,
      { kind: 'group', group: 'dev' },
      true,
    );

    // Assert
    expect(uvGroup.args).toEqual(['add', '--group', 'test', 'pytest==8.3.0']);
    expect(uvDev.args).toEqual(['add', '--dev', 'ruff']);
    expect(uvExtra.args).toEqual(['add', '--optional', 'socks', 'pysocks']);
    expect(poetryGroup).toMatchObject({
      args: ['add', '--group', 'test', 'pytest@latest'],
      title: 'Update pytest',
    });
    expect(pipenvDev.args).toEqual(['install', '--dev', 'pytest']);
  });

  it('addCommand_aRequirementsFile_isRefusedSayingPipCannot', () => {
    // Act
    const act: () => PackageCommand = (): PackageCommand =>
      addCommand(target('pip', 'requirements.txt'), 'requests', null, { kind: 'main' }, false);

    // Assert
    expect(act).toThrow(/pip has no command that changes a requirements file/);
  });

  it('addCommand_aProjectNothingSaysTheToolOf_isRefusedSayingWhy', () => {
    // Act
    const act: () => PackageCommand = (): PackageCommand =>
      addCommand(target(null, 'setup.cfg'), 'requests', null, { kind: 'main' }, false);

    // Assert
    expect(act).toThrow(/can't tell which tool manages setup.cfg/);
  });

  it('addCommand_aPoetryOptionalDependency_isRefused', () => {
    // Act
    const act: () => PackageCommand = (): PackageCommand =>
      addCommand(target('poetry'), 'rich', null, { kind: 'optional', extra: null }, true);

    // Assert
    expect(act).toThrow(/optional dependency/);
  });

  it.each<[string, string, string | null]>([
    ['aNameThatIsAnOption', '--index-url', null],
    ['aNameWithASpace', 'a b', null],
    ['aNameWithAShellCharacter', 'a;rm', null],
    ['aVersionThatIsAnOption', 'requests', '--pre'],
    ['aVersionWithASpace', 'requests', '1.0 -e'],
    ['aVersionThatIsARange', 'requests', '>=1'],
  ])('addCommand_%s_isRefused', (_case: string, name: string, version: string | null) => {
    // Act
    const act: () => PackageCommand = (): PackageCommand =>
      addCommand(target('uv'), name, version, { kind: 'main' }, false);

    // Assert
    expect(act).toThrow();
  });

  it('addCommand_aGroupNameThatIsAnOption_isRefused', () => {
    // Act
    const act: () => PackageCommand = (): PackageCommand =>
      addCommand(target('uv'), 'pytest', null, { kind: 'group', group: '--frozen' }, true);

    // Assert
    expect(act).toThrow(/not a group name/);
  });
});

describe('removeCommand', () => {
  it('removeCommand_eachTool_removesFromWhereItIsDeclared', () => {
    // Act
    const uv: PackageCommand = removeCommand(target('uv'), 'pytest', {
      kind: 'group',
      group: 'test',
    });
    const poetry: PackageCommand = removeCommand(target('poetry'), 'black', {
      kind: 'group',
      group: 'dev',
    });
    const pipenv: PackageCommand = removeCommand(target('pipenv', 'Pipfile'), 'requests', {
      kind: 'main',
    });

    // Assert
    expect(uv).toMatchObject({
      executable: 'uv',
      args: ['remove', '--group', 'test', 'pytest'],
      title: 'Remove pytest',
    });
    expect(poetry.args).toEqual(['remove', '--group', 'dev', 'black']);
    expect(pipenv.args).toEqual(['uninstall', 'requests']);
  });

  it('removeCommand_aRequirementsFile_isRefused', () => {
    // Act
    const act: () => PackageCommand = (): PackageCommand =>
      removeCommand(target('pip', 'requirements.txt'), 'requests', { kind: 'main' });

    // Assert
    expect(act).toThrow(/Remove requests from requirements.txt/);
  });
});

describe('restoreCommand', () => {
  it.each<[PythonTool, boolean, string, readonly string[]]>([
    ['uv', true, 'uv', ['sync']],
    ['poetry', true, 'poetry', ['install']],
    ['pipenv', true, 'pipenv', ['sync', '--dev']],
    ['pipenv', false, 'pipenv', ['install', '--dev']],
  ])(
    'restoreCommand_%s_locked_%s',
    (tool: PythonTool, locked: boolean, executable: string, args: readonly string[]) => {
      // Act
      const command: PackageCommand = restoreCommand(target(tool, 'pyproject.toml', { locked }));

      // Assert
      expect(command).toEqual({ executable, args, cwd: FOLDER, title: 'Restore packages' });
    },
  );

  it('restoreCommand_aRequirementsFileWithAnEnvironment_runsThatEnvironmentsPip', () => {
    // Arrange
    const venv: string = path.join(FOLDER, '.venv');

    // Act
    const command: PackageCommand = restoreCommand(target('pip', 'requirements-dev.txt', { venv }));

    // Assert
    expect(command.executable).toBe(
      process.platform === 'win32'
        ? path.join(venv, 'Scripts', 'python.exe')
        : path.join(venv, 'bin', 'python'),
    );
    expect(command.args).toEqual(['-m', 'pip', 'install', '-r', 'requirements-dev.txt']);
  });

  it('restoreCommand_aRequirementsFileWithNoEnvironment_runsThePythonOnThePath', () => {
    // Act
    const command: PackageCommand = restoreCommand(target('pip', 'requirements.txt'));

    // Assert
    expect(command.executable).toBe(process.platform === 'win32' ? 'python' : 'python3');
  });

  it('restoreCommand_aProjectNothingSaysTheToolOf_isRefused', () => {
    // Act
    const act: () => PackageCommand = (): PackageCommand => restoreCommand(target(null));

    // Assert
    expect(act).toThrow(/can't tell which tool/);
  });
});
