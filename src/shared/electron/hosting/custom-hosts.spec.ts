import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CustomHosts, normalizeHost } from './custom-hosts';

describe('normalizeHost', () => {
  it('acceptsAHostOrAPastedServerUrl_andRefusesAnythingElse', () => {
    expect(normalizeHost(' GitHub.Example.com ')).toBe('github.example.com');
    expect(normalizeHost('https://git.example.com:8443/org/repo')).toBe('git.example.com:8443');
    expect(normalizeHost('localhost')).toBeNull();
    expect(normalizeHost('not a host')).toBeNull();
    expect(normalizeHost('-bad.example.com')).toBeNull();
  });
});

describe('CustomHosts', () => {
  it('addsAndRemovesHostsPerPlugin_andKeepsThemAcrossRestarts', () => {
    const file: string = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'custom-hosts-')),
      'h.json',
    );
    const hosts: CustomHosts = new CustomHosts(file);

    expect(hosts.add('onixlabs.github', 'https://github.example.com/')).toBe('github.example.com');
    expect(hosts.add('onixlabs.github', 'github.example.com')).toBe('github.example.com');
    expect(hosts.add('onixlabs.github', 'nope')).toBeNull();
    expect(new CustomHosts(file).hostsFor('onixlabs.github')).toEqual(['github.example.com']);

    expect(hosts.remove('onixlabs.github', 'github.example.com')).toBe(true);
    expect(hosts.remove('onixlabs.github', 'github.example.com')).toBe(false);
    expect(new CustomHosts(file).hostsFor('onixlabs.github')).toEqual([]);
  });
});
