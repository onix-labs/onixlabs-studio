import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VcpkgEndpointHandler } from './handler';
import type { HttpFetch } from './protocol';
import { BaselineStore } from './registry';

/**
 * A fetch that must never be called: nothing here reaches a registry.
 */
const NO_NETWORK: HttpFetch = (): Promise<never> => Promise.reject(new Error('no network'));

describe('VcpkgEndpointHandler', () => {
  let root: string = '';
  let handler: VcpkgEndpointHandler;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), 'studio-vcpkg-handler-')));
    handler = new VcpkgEndpointHandler(new BaselineStore('https://registry.test', NO_NETWORK));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('initialize_advertisesOnlyWhatVcpkgHas', async () => {
    // Arrange
    const request: { id: number; op: string } = { id: 1, op: 'initialize' };

    // Act
    const response: unknown = await handler.handle(request);

    // Assert
    expect(response).toEqual({
      id: 1,
      ok: true,
      result: {
        protocol: '1.0',
        capabilities: ['sources', 'search', 'install', 'restore'],
        toolVersion: null,
      },
    });
  });

  it('load_aManifestWithTheRegistryUnreachable_stillListsItsDependencies', async () => {
    // Arrange
    writeFileSync(path.join(root, 'vcpkg.json'), JSON.stringify({ dependencies: ['fmt'] }));

    // Act
    const response: unknown = await handler.handle({ id: 2, op: 'load', root });

    // Assert
    expect(response).toMatchObject({
      ok: true,
      result: {
        ecosystem: 'vcpkg',
        projects: [{ packages: [{ name: 'fmt', latest: null, status: 'unknown' }] }],
      },
    });
  });

  it('sources_isTheBuiltinRegistry', async () => {
    // Arrange
    const request: { id: number; op: string; root: string } = { id: 3, op: 'sources', root };

    // Act
    const response: unknown = await handler.handle(request);

    // Assert
    expect(response).toEqual({ id: 3, ok: true, result: { sources: [{ name: 'vcpkg' }] } });
  });

  it('install_answersACommandAndRunsNothing', async () => {
    // Arrange
    const project: string = path.join(root, 'vcpkg.json');

    // Act
    const response: unknown = await handler.handle({
      id: 4,
      op: 'install',
      root,
      params: { project, name: 'fmt', version: null },
    });

    // Assert
    expect(response).toEqual({
      id: 4,
      ok: true,
      result: { executable: 'vcpkg', args: ['add', 'port', 'fmt'], cwd: root, title: 'Add fmt' },
    });
  });

  it('restore_isVcpkgInstall', async () => {
    // Arrange
    const project: string = path.join(root, 'vcpkg.json');

    // Act
    const response: unknown = await handler.handle({
      id: 5,
      op: 'restore',
      root,
      params: { project },
    });

    // Assert
    expect(response).toMatchObject({ ok: true, result: { args: ['install'], cwd: root } });
  });

  it('updateAndRemove_sayVcpkgHasNoSuchCommand', async () => {
    // Arrange
    const params: Record<string, unknown> = { project: path.join(root, 'vcpkg.json'), name: 'fmt' };

    // Act
    const update: unknown = await handler.handle({ id: 6, op: 'update', root, params });
    const remove: unknown = await handler.handle({ id: 7, op: 'remove', root, params });

    // Assert
    expect(update).toMatchObject({
      ok: false,
      error: expect.stringContaining('override') as unknown,
    });
    expect(remove).toMatchObject({
      ok: false,
      error: expect.stringContaining('vcpkg.json') as unknown,
    });
  });

  it('load_withoutAFolder_fails', async () => {
    // Arrange
    const request: { id: number; op: string } = { id: 8, op: 'load' };

    // Act
    const response: unknown = await handler.handle(request);

    // Assert
    expect(response).toEqual({ id: 8, ok: false, error: 'load needs a folder.' });
  });
});
