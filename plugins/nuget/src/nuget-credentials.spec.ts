import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NuGetPackageManager } from './nuget';
import type { HttpFetch, HttpResponse } from './protocol';

/**
 * A private feed's service index, named by the fixtures.
 */
const FEED: string = 'https://feed.example/v3/index.json';

/**
 * A feed that answers with an empty service index, recording each request's Authorization header.
 * @param seen Receives the requests.
 * @returns Returns the fetch.
 */
function recording(seen: string[]): HttpFetch {
  return (url: string, init?: { headers?: Record<string, string> }): Promise<HttpResponse> => {
    seen.push(`${url} ${init?.headers?.['Authorization'] ?? 'none'}`);
    return Promise.resolve({
      ok: true,
      status: 200,
      json: (): Promise<unknown> => Promise.resolve({ resources: [] }),
    });
  };
}

describe('NuGet credentials', () => {
  let root: string = '';

  /**
   * Writes a project and a config clearing every source but the private feed.
   * @param credentials The config's credentials section.
   */
  function writeFixture(credentials: string = ''): void {
    writeFileSync(
      path.join(root, 'Api.csproj'),
      '<Project><ItemGroup><PackageReference Include="Serilog" Version="3.0.0" /></ItemGroup></Project>',
    );
    writeFileSync(
      path.join(root, 'nuget.config'),
      `<configuration><packageSources><clear /><add key="private" value="${FEED}" /></packageSources>${credentials}</configuration>`,
    );
  }

  /**
   * Writes the user-level config in the spec's home, where `readNuGetSources` looks for it on every
   * platform the suite runs on.
   * @param xml The config contents.
   */
  function writeUserConfig(xml: string): void {
    const directory: string =
      process.platform === 'win32' ? path.join(root, 'NuGet') : path.join(root, '.nuget', 'NuGet');
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, 'NuGet.Config'), xml);
  }

  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), 'studio-nuget-credentials-')));
    // The user's own NuGet.Config holds feed passwords, and has no place in a spec.
    vi.stubEnv('HOME', root);
    vi.stubEnv('USERPROFILE', root);
    vi.stubEnv('APPDATA', root);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it('sendsTheCredentialTheConfigurationHolds_withoutAskingStudio', async () => {
    writeFixture(
      '<packageSourceCredentials><private><add key="Username" value="me" /><add key="ClearTextPassword" value="from-config" /></private></packageSourceCredentials>',
    );
    const asked: string[] = [];
    const seen: string[] = [];
    const manager: NuGetPackageManager = new NuGetPackageManager((registry: string) => {
      asked.push(registry);
      return Promise.resolve('from-studio');
    }, {});

    await manager.load(root, recording(seen));

    expect(asked).toEqual([]);
    expect(seen[0]).toBe(`${FEED} Basic ${Buffer.from('me:from-config').toString('base64')}`);
  });

  it('asksStudioOnly_whenTheConfigurationHoldsNone', async () => {
    writeFixture();
    const asked: string[] = [];
    const seen: string[] = [];
    const manager: NuGetPackageManager = new NuGetPackageManager((registry: string) => {
      asked.push(registry);
      return Promise.resolve('from-studio');
    }, {});

    await manager.load(root, recording(seen));

    expect(asked).toEqual([FEED]);
    expect(seen[0]).toBe(`${FEED} Basic ${Buffer.from(':from-studio').toString('base64')}`);
  });

  it('neverAsksStudioAboutNugetOrg', async () => {
    writeFileSync(
      path.join(root, 'Api.csproj'),
      '<Project><ItemGroup><PackageReference Include="Serilog" Version="3.0.0" /></ItemGroup></Project>',
    );
    const asked: string[] = [];
    const manager: NuGetPackageManager = new NuGetPackageManager((registry: string) => {
      asked.push(registry);
      return Promise.resolve('from-studio');
    }, {});

    await manager.load(root, recording([]));

    expect(asked).toEqual([]);
  });

  it('sendsNoHeader_whenAReferenceResolvesToNothing', async () => {
    writeFixture(
      '<packageSourceCredentials><private><add key="Username" value="me" /><add key="ClearTextPassword" value="%NUGET_TOKEN%" /></private></packageSourceCredentials>',
    );
    const seen: string[] = [];
    const manager: NuGetPackageManager = new NuGetPackageManager(undefined, {});

    await manager.load(root, recording(seen));

    expect(seen[0]).toBe(`${FEED} none`);
  });

  it('load_projectConfigReferencesAnEnvironmentVariable_sendsNoHeader', async () => {
    // Arrange
    writeFixture(
      '<packageSourceCredentials><private><add key="Username" value="me" /><add key="ClearTextPassword" value="%NUGET_TOKEN%" /></private></packageSourceCredentials>',
    );
    const seen: string[] = [];
    const manager: NuGetPackageManager = new NuGetPackageManager(undefined, {
      NUGET_TOKEN: 'from-environment',
    });

    // Act
    await manager.load(root, recording(seen));

    // Assert
    expect(seen[0]).toBe(`${FEED} none`);
  });

  it('load_userConfigReferencesAnEnvironmentVariable_sendsIt', async () => {
    // Arrange
    writeFixture();
    writeUserConfig(
      `<configuration><packageSources><add key="private" value="${FEED}" /></packageSources><packageSourceCredentials><private><add key="Username" value="me" /><add key="ClearTextPassword" value="%NUGET_TOKEN%" /></private></packageSourceCredentials></configuration>`,
    );
    const seen: string[] = [];
    const manager: NuGetPackageManager = new NuGetPackageManager(undefined, {
      NUGET_TOKEN: 'from-environment',
    });

    // Act
    await manager.load(root, recording(seen));

    // Assert
    expect(seen[0]).toBe(`${FEED} Basic ${Buffer.from('me:from-environment').toString('base64')}`);
  });

  it('load_projectConfigPointsTheUsersCredentialedSourceElsewhere_sendsNoCredential', async () => {
    // Arrange
    writeUserConfig(
      `<configuration><packageSources><add key="private" value="https://trusted.example/v3/index.json" /></packageSources><packageSourceCredentials><private><add key="Username" value="me" /><add key="ClearTextPassword" value="user-secret" /></private></packageSourceCredentials></configuration>`,
    );
    writeFixture();
    const seen: string[] = [];
    const manager: NuGetPackageManager = new NuGetPackageManager(undefined, {});

    // Act
    await manager.load(root, recording(seen));

    // Assert
    expect(seen).toEqual([`${FEED} none`]);
  });

  it('load_plainHttpSource_neverAsksStudioForAToken', async () => {
    // Arrange
    writeFileSync(
      path.join(root, 'Api.csproj'),
      '<Project><ItemGroup><PackageReference Include="Serilog" Version="3.0.0" /></ItemGroup></Project>',
    );
    writeFileSync(
      path.join(root, 'nuget.config'),
      '<configuration><packageSources><clear /><add key="private" value="http://feed.example/v3/index.json" /></packageSources></configuration>',
    );
    const asked: string[] = [];
    const seen: string[] = [];
    const manager: NuGetPackageManager = new NuGetPackageManager((registry: string) => {
      asked.push(registry);
      return Promise.resolve('from-studio');
    }, {});

    // Act
    await manager.load(root, recording(seen));

    // Assert
    expect(asked).toEqual([]);
    expect(seen).toEqual(['http://feed.example/v3/index.json none']);
  });

  it('neverListsACredentialAmongTheSources', async () => {
    writeFixture(
      '<packageSourceCredentials><private><add key="Username" value="me" /><add key="ClearTextPassword" value="from-config" /></private></packageSourceCredentials>',
    );
    const manager: NuGetPackageManager = new NuGetPackageManager(undefined, {});

    await expect(manager.listSources(root)).resolves.toEqual([{ name: 'private' }]);
  });
});
