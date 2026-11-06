import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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

  it('neverListsACredentialAmongTheSources', async () => {
    writeFixture(
      '<packageSourceCredentials><private><add key="Username" value="me" /><add key="ClearTextPassword" value="from-config" /></private></packageSourceCredentials>',
    );
    const manager: NuGetPackageManager = new NuGetPackageManager(undefined, {});

    await expect(manager.listSources(root)).resolves.toEqual([{ name: 'private' }]);
  });
});
