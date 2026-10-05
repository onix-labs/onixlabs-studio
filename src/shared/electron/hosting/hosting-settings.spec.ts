import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HostingSettings } from './hosting-settings';

describe('HostingSettings', () => {
  let directory: string;
  let file: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hosting-settings-'));
    file = path.join(directory, 'hosting.json');
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('keepsAChoicePerHost_andReadsItBack', () => {
    // One plugin can serve github.com and a company server, signed in differently to each.
    const settings: HostingSettings = new HostingSettings(file);
    settings.setAuth('onixlabs.github', 'GitHub.com', 'cli');
    settings.setAuth('onixlabs.github', 'ghe.example.com', 'studio');

    expect(new HostingSettings(file).authFor('onixlabs.github')).toEqual({
      'github.com': 'cli',
      'ghe.example.com': 'studio',
    });
  });

  it('clearingAChoice_returnsTheHostToThePluginsDefault', () => {
    const settings: HostingSettings = new HostingSettings(file);
    settings.setAuth('onixlabs.github', 'github.com', 'studio');
    settings.setAuth('onixlabs.github', 'github.com', null);

    expect(new HostingSettings(file).authFor('onixlabs.github')).toEqual({});
  });

  it('ignoresAMalformedFileOrEntry', () => {
    fs.writeFileSync(
      file,
      JSON.stringify({ a: { 'github.com': 'oauth', 'gitlab.com': 'cli' }, b: 'x' }),
    );
    expect(new HostingSettings(file).authFor('a')).toEqual({ 'gitlab.com': 'cli' });
    expect(new HostingSettings(file).authFor('b')).toEqual({});

    fs.writeFileSync(file, 'not json');
    expect(new HostingSettings(file).authFor('a')).toEqual({});
  });
});
