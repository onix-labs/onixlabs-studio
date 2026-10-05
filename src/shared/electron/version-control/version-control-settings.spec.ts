import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readExecutableChoice, VersionControlSettings } from './version-control-settings';

describe('readExecutableChoice', () => {
  it('acceptsAKnownMode_andACustomPathOnlyWhenAbsolute', () => {
    expect(readExecutableChoice({ mode: 'installed', path: 'ignored' })).toEqual({
      mode: 'installed',
      path: '',
    });
    expect(readExecutableChoice({ mode: 'custom', path: '/opt/git' })).toEqual({
      mode: 'custom',
      path: '/opt/git',
    });
    expect(readExecutableChoice({ mode: 'custom', path: 'git' })).toBeNull();
    expect(readExecutableChoice({ mode: 'downloaded', path: '' })).toBeNull();
    expect(readExecutableChoice('installed')).toBeNull();
  });
});

describe('VersionControlSettings', () => {
  let directory: string;
  let file: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vcs-settings-'));
    file = path.join(directory, 'version-control.json');
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('persistsAChoice_andReadsItBack', () => {
    new VersionControlSettings(file).setExecutable('onixlabs.git', {
      mode: 'custom',
      path: '/opt/git',
    });

    expect(new VersionControlSettings(file).executableFor('onixlabs.git')).toEqual({
      mode: 'custom',
      path: '/opt/git',
    });
  });

  it('clearingAChoice_returnsThePluginToItsDefault', () => {
    const settings: VersionControlSettings = new VersionControlSettings(file);
    settings.setExecutable('onixlabs.git', { mode: 'custom', path: '/opt/git' });
    settings.setExecutable('onixlabs.git', null);

    expect(new VersionControlSettings(file).executableFor('onixlabs.git')).toBeNull();
  });

  it('ignoresAMalformedFileOrEntry', () => {
    fs.writeFileSync(file, JSON.stringify({ a: { mode: 'custom', path: 'relative' }, b: 'x' }));
    expect(new VersionControlSettings(file).executableFor('a')).toBeNull();

    fs.writeFileSync(file, 'not json');
    expect(new VersionControlSettings(file).executableFor('a')).toBeNull();
  });
});
