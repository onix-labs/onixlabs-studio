import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MavenEndpointHandler } from './handler';
import type { HttpFetch } from './protocol';

/**
 * A fetch that must never be called: nothing here reaches a repository.
 */
const NO_NETWORK: HttpFetch = (): Promise<never> => Promise.reject(new Error('no network'));

describe('MavenEndpointHandler', () => {
  let root: string = '';
  let handler: MavenEndpointHandler;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), 'studio-maven-handler-')));
    // The user's own ~/.m2/settings.xml holds repository passwords, and has no place in a spec.
    vi.stubEnv('HOME', root);
    vi.stubEnv('USERPROFILE', root);
    handler = new MavenEndpointHandler(NO_NETWORK, () => Promise.resolve(null));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it('initialize_advertisesSearchWithAQueryAndRestoreOnly', async () => {
    await expect(handler.handle({ id: 1, op: 'initialize' })).resolves.toEqual({
      id: 1,
      ok: true,
      result: {
        protocol: '1.0',
        capabilities: ['sources', 'search', 'searchRequiresQuery', 'restore'],
        toolVersion: null,
      },
    });
  });

  it('load_aFolderWithNoBuild_answersNull', async () => {
    await expect(handler.handle({ id: 2, op: 'load', root })).resolves.toEqual({
      id: 2,
      ok: true,
      result: null,
    });
  });

  it('load_aPomWithoutAReachableRepository_stillReadsIt', async () => {
    writeFileSync(
      path.join(root, 'pom.xml'),
      '<project><artifactId>demo</artifactId><dependencies><dependency><groupId>g</groupId><artifactId>a</artifactId><version>1.0</version></dependency></dependencies></project>',
    );

    await expect(handler.handle({ id: 3, op: 'load', root })).resolves.toMatchObject({
      ok: true,
      result: {
        ecosystem: 'maven',
        projects: [{ name: 'demo', packages: [{ name: 'g:a', latest: null, status: 'unknown' }] }],
      },
    });
  });

  it('sources_namesMavenCentralOnly', async () => {
    await expect(handler.handle({ id: 4, op: 'sources', root })).resolves.toEqual({
      id: 4,
      ok: true,
      result: { sources: [{ name: 'Maven Central' }] },
    });
  });

  it('install_isAnsweredWithWhyNot', async () => {
    await expect(
      handler.handle({ id: 5, op: 'install', root, params: { project: 'x', name: 'g:a' } }),
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('edit the pom.xml') as unknown,
    });
  });

  it('anOperationWithNoFolder_fails', async () => {
    await expect(handler.handle({ id: 6, op: 'load' })).resolves.toMatchObject({ ok: false });
  });

  it('anUnknownOperation_fails', async () => {
    await expect(handler.handle({ id: 7, op: 'explode', root })).resolves.toMatchObject({
      ok: false,
    });
  });
});
