import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { addCommand, NodeTool, removeCommand, restoreCommand, toolFor } from './commands';

/**
 * A project manifest.
 */
const PROJECT: string = path.resolve('/workspace/web/package.json');

describe('toolFor', () => {
  it.each<[readonly string[], NodeTool]>([
    [['pnpm-lock.yaml', 'package.json'], 'pnpm'],
    [['yarn.lock'], 'yarn'],
    [['package-lock.json'], 'npm'],
    [[], 'npm'],
  ])('reads %j as %s', (files: readonly string[], tool: NodeTool) => {
    expect(toolFor(files)).toBe(tool);
  });
});

describe('addCommand', () => {
  it.each<[NodeTool, string]>([
    ['npm', 'install'],
    ['pnpm', 'add'],
    ['yarn', 'add'],
  ])('%s_usesItsOwnVerb', (tool: NodeTool, verb: string) => {
    expect(addCommand(tool, PROJECT, 'left-pad', '1.3.0', 'Install left-pad')).toEqual({
      executable: tool,
      args: [verb, 'left-pad@1.3.0'],
      cwd: path.dirname(PROJECT),
      title: 'Install left-pad',
    });
  });

  it('asksForTheLatest_withNoVersion', () => {
    expect(addCommand('npm', PROJECT, '@scope/a', null, 't').args).toEqual(['install', '@scope/a']);
  });

  it.each<string>(['--global', '-g', 'a b', '../evil', ''])('refusesTheName_%s', (name: string) => {
    expect(() => addCommand('npm', PROJECT, name, null, 't')).toThrow();
  });

  it.each<string>(['--save-dev', '1.0.0 evil', ''])('refusesTheVersion_%s', (version: string) => {
    expect(() => addCommand('npm', PROJECT, 'a', version, 't')).toThrow();
  });
});

describe('removeCommand', () => {
  it.each<[NodeTool, string]>([
    ['npm', 'uninstall'],
    ['pnpm', 'remove'],
    ['yarn', 'remove'],
  ])('%s_usesItsOwnVerb', (tool: NodeTool, verb: string) => {
    expect(removeCommand(tool, PROJECT, 'a').args).toEqual([verb, 'a']);
  });

  it('refusesANameReadAsAnOption', () => {
    expect(() => removeCommand('npm', PROJECT, '--global')).toThrow();
  });
});

describe('restoreCommand', () => {
  it('installsInTheProjectsFolder', () => {
    expect(restoreCommand('yarn', PROJECT)).toEqual({
      executable: 'yarn',
      args: ['install'],
      cwd: path.dirname(PROJECT),
      title: 'Restore packages',
    });
  });
});
