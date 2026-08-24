import { NuGetConfig, parseNuGetConfig } from './nuget-config';
import { NuGetSource, resolveSources } from './nuget-sources';

describe('parseNuGetConfig', () => {
  it('reads ordered source operations and credentials with %ENV% interpolation', () => {
    const xml: string = `<?xml version="1.0"?>
      <configuration>
        <packageSources>
          <clear />
          <add key="nuget.org" value="https://api.nuget.org/v3/index.json" />
          <add key="github" value="https://nuget.pkg.github.com/acme/index.json" />
        </packageSources>
        <packageSourceCredentials>
          <github>
            <add key="Username" value="acme-bot" />
            <add key="ClearTextPassword" value="%GH_PAT%" />
          </github>
        </packageSourceCredentials>
      </configuration>`;
    const config: NuGetConfig = parseNuGetConfig(xml, { GH_PAT: 'pat-xyz' });
    expect(config.operations).toEqual([
      { kind: 'clear' },
      { kind: 'add', name: 'nuget.org', url: 'https://api.nuget.org/v3/index.json' },
      { kind: 'add', name: 'github', url: 'https://nuget.pkg.github.com/acme/index.json' },
    ]);
    expect(config.credentials['github']).toEqual({ username: 'acme-bot', password: 'pat-xyz' });
  });

  it('decodes _x0020_ space escaping in credential source names', () => {
    const xml: string = `<configuration><packageSourceCredentials>
      <My_x0020_Feed><add key="ClearTextPassword" value="p" /></My_x0020_Feed>
    </packageSourceCredentials></configuration>`;
    expect(parseNuGetConfig(xml, {}).credentials['my feed']).toEqual({ password: 'p' });
  });
});

describe('resolveSources', () => {
  it('seeds nuget.org, applies clear then adds, and attaches basic auth from credentials', () => {
    const config: NuGetConfig = parseNuGetConfig(
      `<configuration>
        <packageSources>
          <add key="github" value="https://nuget.pkg.github.com/acme/index.json" />
        </packageSources>
        <packageSourceCredentials>
          <github><add key="Username" value="u" /><add key="ClearTextPassword" value="t" /></github>
        </packageSourceCredentials>
      </configuration>`,
      {},
    );
    const sources: readonly NuGetSource[] = resolveSources([config]);
    const github: NuGetSource | undefined = sources.find(
      (s: NuGetSource): boolean => s.name === 'github',
    );
    // nuget.org is seeded and kept (no <clear/>), plus the added github source.
    expect(sources.map((s: NuGetSource): string => s.name)).toEqual(['nuget.org', 'github']);
    expect(github?.headers).toEqual({
      Authorization: `Basic ${Buffer.from('u:t').toString('base64')}`,
    });
  });

  it('drops the seeded default when a <clear/> resets the sources', () => {
    const config: NuGetConfig = parseNuGetConfig(
      `<configuration><packageSources>
        <clear />
        <add key="only" value="https://feed/index.json" />
      </packageSources></configuration>`,
      {},
    );
    expect(resolveSources([config]).map((s: NuGetSource): string => s.name)).toEqual(['only']);
  });
});
