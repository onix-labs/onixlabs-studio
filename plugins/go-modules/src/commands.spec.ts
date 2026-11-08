import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { addCommand, removeCommand, restoreCommand } from './commands';
import type { PackageCommand } from './protocol';

/**
 * A module's go.mod.
 */
const PROJECT: string = path.resolve('/workspace/api/go.mod');

describe('addCommand', () => {
  it('addCommand_version_isGoGetAtThatVersionInTheModulesDirectory', () => {
    // Arrange, Act
    const command: PackageCommand = addCommand(
      PROJECT,
      'github.com/BurntSushi/toml',
      'v1.4.0',
      'Update github.com/BurntSushi/toml',
    );

    // Assert
    expect(command).toEqual({
      executable: 'go',
      args: ['get', 'github.com/BurntSushi/toml@v1.4.0'],
      cwd: path.dirname(PROJECT),
      title: 'Update github.com/BurntSushi/toml',
    });
  });

  it('addCommand_noVersion_isLatest', () => {
    expect(addCommand(PROJECT, 'golang.org/x/mod', null, 'Install golang.org/x/mod').args).toEqual([
      'get',
      'golang.org/x/mod@latest',
    ]);
  });

  it.each<[string]>([['-x'], ['--help'], ['a b'], ['x;rm'], ['none'], ['v1/../x'], ['']])(
    'addCommand_version%j_isRefused',
    (version: string) => {
      expect(() => addCommand(PROJECT, 'golang.org/x/mod', version, 'Install')).toThrow(
        'is not a version',
      );
    },
  );

  it.each<[string]>([['-modfile=/tmp/x'], ['golang.org/x/mod@v1'], ['a b'], ['../x'], ['']])(
    'addCommand_module%j_isRefused',
    (name: string) => {
      expect(() => addCommand(PROJECT, name, null, 'Install')).toThrow('is not a Go module path');
    },
  );

  it('addCommand_projectThatIsNotAGoMod_isRefusedInTheUsersTerms', () => {
    expect(() =>
      addCommand(path.resolve('/workspace/go.work'), 'golang.org/x/mod', null, 'Install'),
    ).toThrow('Packages can only be changed in a Go module');
  });
});

describe('removeCommand', () => {
  it('removeCommand_module_isGoGetAtNone', () => {
    expect(removeCommand(PROJECT, 'golang.org/x/mod')).toEqual({
      executable: 'go',
      args: ['get', 'golang.org/x/mod@none'],
      cwd: path.dirname(PROJECT),
      title: 'Remove golang.org/x/mod',
    });
  });

  it('removeCommand_optionShapedName_isRefused', () => {
    expect(() => removeCommand(PROJECT, '-u')).toThrow('is not a Go module path');
  });
});

describe('restoreCommand', () => {
  it('restoreCommand_module_isGoModDownload', () => {
    expect(restoreCommand(PROJECT)).toEqual({
      executable: 'go',
      args: ['mod', 'download'],
      cwd: path.dirname(PROJECT),
      title: 'Download modules',
    });
  });
});
