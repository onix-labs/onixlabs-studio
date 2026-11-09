import { NuGetConfig, parseNuGetConfig } from './nuget-config';
import { mayCarryCredentials, NuGetSource, resolveSources } from './nuget-sources';

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

/**
 * Builds a config declaring one source, with an optional credential for it.
 * @param name The source name.
 * @param url The source URL, or null to declare no source.
 * @param password The credential's password, or null to declare none.
 * @returns Returns the parsed config.
 */
function feedConfig(name: string, url: string | null, password: string | null): NuGetConfig {
  const sources: string = url === null ? '' : `<add key="${name}" value="${url}" />`;
  const credentials: string =
    password === null
      ? ''
      : `<packageSourceCredentials><${name}><add key="Username" value="u" />` +
        `<add key="ClearTextPassword" value="${password}" /></${name}></packageSourceCredentials>`;
  return parseNuGetConfig(
    `<configuration><packageSources>${sources}</packageSources>${credentials}</configuration>`,
    {},
  );
}

/**
 * Finds a resolved source's headers by name.
 * @param sources The resolved sources.
 * @param name The source name.
 * @returns Returns the headers, or undefined when there is no such source.
 */
function headersOf(
  sources: readonly NuGetSource[],
  name: string,
): Record<string, string> | undefined {
  return sources.find((source: NuGetSource): boolean => source.name === name)?.headers;
}

describe('resolveSources credential binding', () => {
  const basic: string = `Basic ${Buffer.from('u:secret').toString('base64')}`;

  it('resolveSources_laterConfigRedefinesACredentialedSourcesUrl_sendsNoCredential', () => {
    // Arrange
    const user: NuGetConfig = feedConfig('private', 'https://feed.example/index.json', 'secret');
    const project: NuGetConfig = feedConfig('private', 'https://evil.example/index.json', null);

    // Act
    const sources: readonly NuGetSource[] = resolveSources([user, project]);

    // Assert
    expect(headersOf(sources, 'private')).toEqual({});
  });

  it('resolveSources_laterConfigAddsTheNameInAnotherCase_sendsTheCredentialOnlyToTheOriginalUrl', () => {
    // Arrange
    const user: NuGetConfig = feedConfig('private', 'https://feed.example/index.json', 'secret');
    const project: NuGetConfig = feedConfig('PRIVATE', 'https://evil.example/index.json', null);

    // Act
    const sources: readonly NuGetSource[] = resolveSources([user, project]);

    // Assert
    expect(headersOf(sources, 'PRIVATE')).toEqual({});
    expect(headersOf(sources, 'private')).toEqual({ Authorization: basic });
  });

  it('resolveSources_laterConfigRedeclaresTheSameUrl_keepsTheCredential', () => {
    // Arrange
    const user: NuGetConfig = feedConfig('private', 'https://feed.example/index.json', 'secret');
    const project: NuGetConfig = feedConfig('private', 'https://feed.example/index.json', null);

    // Act
    const sources: readonly NuGetSource[] = resolveSources([user, project]);

    // Assert
    expect(headersOf(sources, 'private')).toEqual({ Authorization: basic });
  });

  it('resolveSources_credentialDeclaredWithoutItsSource_sendsNoCredential', () => {
    // Arrange
    const user: NuGetConfig = feedConfig('private', null, 'secret');
    const project: NuGetConfig = feedConfig('private', 'https://evil.example/index.json', null);

    // Act
    const sources: readonly NuGetSource[] = resolveSources([user, project]);

    // Assert
    expect(headersOf(sources, 'private')).toEqual({});
  });

  it('resolveSources_plainHttpRemoteSource_sendsNoCredential', () => {
    // Arrange
    const config: NuGetConfig = feedConfig('private', 'http://feed.example/index.json', 'secret');

    // Act
    const sources: readonly NuGetSource[] = resolveSources([config]);

    // Assert
    expect(headersOf(sources, 'private')).toEqual({});
  });

  it('resolveSources_plainHttpLoopbackSource_sendsTheCredential', () => {
    // Arrange
    const config: NuGetConfig = feedConfig('private', 'http://localhost:5555/index.json', 'secret');

    // Act
    const sources: readonly NuGetSource[] = resolveSources([config]);

    // Assert
    expect(headersOf(sources, 'private')).toEqual({ Authorization: basic });
  });
});

describe('mayCarryCredentials', () => {
  it('mayCarryCredentials_eachKindOfUrl_allowsOnlyHttpsAndLoopback', () => {
    // Arrange
    const urls: readonly string[] = [
      'https://feed.example/index.json',
      'http://feed.example/index.json',
      'http://localhost/index.json',
      'http://127.0.0.1:8080/index.json',
      'http://[::1]/index.json',
      '/local/packages',
    ];

    // Act
    const results: readonly boolean[] = urls.map((url: string): boolean =>
      mayCarryCredentials(url),
    );

    // Assert
    expect(results).toEqual([true, false, true, true, true, false]);
  });
});
