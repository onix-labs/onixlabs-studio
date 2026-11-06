import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NuGetEndpointHandler } from './handler';
import type { HttpFetch } from './protocol';

/**
 * A fetch that must never be called: nothing here reaches a feed.
 */
const NO_NETWORK: HttpFetch = (): Promise<never> => Promise.reject(new Error('no network'));

describe('NuGetEndpointHandler', () => {
  let root: string = '';
  let handler: NuGetEndpointHandler;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), 'studio-nuget-handler-')));
    // The user's own NuGet.Config holds feed passwords, and has no place in a spec.
    vi.stubEnv('HOME', root);
    vi.stubEnv('USERPROFILE', root);
    vi.stubEnv('APPDATA', root);
    handler = new NuGetEndpointHandler(NO_NETWORK, () => Promise.resolve(null), {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it('initialize_advertisesPrereleaseAndSearchWithNoQuery', async () => {
    await expect(handler.handle({ id: 1, op: 'initialize' })).resolves.toMatchObject({
      result: {
        protocol: '1.0',
        capabilities: expect.arrayContaining(['search', 'prerelease']) as unknown,
      },
    });
    await expect(handler.handle({ id: 1, op: 'initialize' })).resolves.not.toMatchObject({
      result: { capabilities: expect.arrayContaining(['searchRequiresQuery']) as unknown },
    });
  });

  it('load_answersNullForAFolderWithNoProjects', async () => {
    await expect(handler.handle({ id: 2, op: 'load', root })).resolves.toEqual({
      id: 2,
      ok: true,
      result: null,
    });
  });

  it('load_readsAProjectWithoutAFeed', async () => {
    writeFileSync(path.join(root, 'Api.csproj'), '<Project></Project>');

    await expect(handler.handle({ id: 3, op: 'load', root })).resolves.toMatchObject({
      ok: true,
      result: { ecosystem: 'nuget', projects: [{ name: 'Api', packages: [] }] },
    });
  });

  it('sources_includeNugetOrg', async () => {
    await expect(handler.handle({ id: 4, op: 'sources', root })).resolves.toMatchObject({
      result: { sources: [{ name: 'nuget.org' }] },
    });
  });

  it('install_andUpdate_sayWhichTheyAre', async () => {
    const params: Record<string, unknown> = {
      project: path.join(root, 'Api.csproj'),
      name: 'Serilog',
      version: '4.0.0',
    };

    await expect(handler.handle({ id: 5, op: 'install', root, params })).resolves.toMatchObject({
      result: { title: 'Install Serilog' },
    });
    await expect(handler.handle({ id: 6, op: 'update', root, params })).resolves.toMatchObject({
      result: { title: 'Update Serilog' },
    });
  });

  it('remove_andRestore_answerCommands', async () => {
    const params: Record<string, unknown> = {
      project: path.join(root, 'Api.csproj'),
      name: 'Serilog',
    };

    await expect(handler.handle({ id: 7, op: 'remove', root, params })).resolves.toMatchObject({
      result: { executable: 'dotnet', args: ['remove', 'Api.csproj', 'package', 'Serilog'] },
    });
    await expect(handler.handle({ id: 8, op: 'restore', root, params })).resolves.toMatchObject({
      result: { executable: 'dotnet', args: ['restore', 'Api.csproj'] },
    });
  });

  it('failsAWriteNamingAnIdReadAsAnOption', async () => {
    await expect(
      handler.handle({
        id: 9,
        op: 'remove',
        root,
        params: { project: path.join(root, 'Api.csproj'), name: '--interactive' },
      }),
    ).resolves.toMatchObject({ id: 9, ok: false });
  });

  it('failsAnOperationItDoesNotKnow_andARequestNamingNoFolder', async () => {
    await expect(handler.handle({ id: 10, op: 'publish', root })).resolves.toMatchObject({
      ok: false,
    });
    await expect(handler.handle({ id: 11, op: 'load' })).resolves.toMatchObject({ ok: false });
  });
});
