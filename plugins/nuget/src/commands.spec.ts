import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { addCommand, removeCommand, restoreCommand } from './commands';

/**
 * A project file.
 */
const PROJECT: string = path.resolve('/workspace/src/Api/Api.csproj');

describe('addCommand', () => {
  it('addsAPackageAtAVersion_inTheProjectsFolder', () => {
    expect(addCommand(PROJECT, 'Serilog', '4.0.0', 'Install Serilog')).toEqual({
      executable: 'dotnet',
      args: ['add', 'Api.csproj', 'package', 'Serilog', '--version', '4.0.0'],
      cwd: path.dirname(PROJECT),
      title: 'Install Serilog',
    });
  });

  it('asksForTheLatest_withNoVersion', () => {
    expect(addCommand(PROJECT, 'Serilog', null, 't').args).toEqual([
      'add',
      'Api.csproj',
      'package',
      'Serilog',
    ]);
  });

  it('acceptsAVersionRange', () => {
    expect(addCommand(PROJECT, 'Serilog', '[4.0.0,5.0.0)', 't').args).toContain('[4.0.0,5.0.0)');
  });

  it.each<string>(['--source', '-s', 'a b', ''])('refusesTheId_%s', (id: string) => {
    expect(() => addCommand(PROJECT, id, null, 't')).toThrow();
  });

  it.each<string>(['--prerelease', '1.0 evil', ''])('refusesTheVersion_%s', (version: string) => {
    expect(() => addCommand(PROJECT, 'Serilog', version, 't')).toThrow();
  });
});

describe('removeCommand', () => {
  it('removesAPackage', () => {
    expect(removeCommand(PROJECT, 'Serilog')).toEqual({
      executable: 'dotnet',
      args: ['remove', 'Api.csproj', 'package', 'Serilog'],
      cwd: path.dirname(PROJECT),
      title: 'Remove Serilog',
    });
  });

  it('refusesAnIdReadAsAnOption', () => {
    expect(() => removeCommand(PROJECT, '--interactive')).toThrow();
  });
});

describe('restoreCommand', () => {
  it('restoresTheProject', () => {
    expect(restoreCommand(PROJECT)).toEqual({
      executable: 'dotnet',
      args: ['restore', 'Api.csproj'],
      cwd: path.dirname(PROJECT),
      title: 'Restore packages',
    });
  });
});
