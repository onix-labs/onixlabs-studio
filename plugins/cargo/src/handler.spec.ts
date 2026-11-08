import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CargoEndpointHandler } from './handler';
import type { HttpFetch } from './protocol';

/**
 * A fetch that must never be called: nothing here reaches a registry.
 */
const NO_NETWORK: HttpFetch = (): Promise<never> => Promise.reject(new Error('no network'));

describe('CargoEndpointHandler', () => {
  let root: string = '';
  let handler: CargoEndpointHandler;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), 'studio-cargo-handler-')));
    const home: string = path.join(root, '.cargo-home');
    mkdirSync(home);
    // The user's own ~/.cargo holds registry tokens, and has no place in a spec.
    vi.stubEnv('HOME', root);
    vi.stubEnv('USERPROFILE', root);
    handler = new CargoEndpointHandler(NO_NETWORK, () => Promise.resolve(null), {
      CARGO_HOME: home,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it('initialize_advertisesPrereleaseAndSearchWithNoQuery', async () => {
    // Arrange
    const request: { id: number; op: string } = { id: 1, op: 'initialize' };

    // Act
    const response: Awaited<ReturnType<CargoEndpointHandler['handle']>> =
      await handler.handle(request);

    // Assert
    expect(response).toMatchObject({
      ok: true,
      result: {
        protocol: '1.0',
        capabilities: expect.arrayContaining(['search', 'prerelease', 'install']) as unknown,
      },
    });
    expect(response).not.toMatchObject({
      result: { capabilities: expect.arrayContaining(['searchRequiresQuery']) as unknown },
    });
  });

  it('load_folderWithNoCrate_answersNull', async () => {
    // Arrange
    const request: { id: number; op: string; root: string } = { id: 2, op: 'load', root };

    // Act
    const response: Awaited<ReturnType<CargoEndpointHandler['handle']>> =
      await handler.handle(request);

    // Assert
    expect(response).toEqual({ id: 2, ok: true, result: null });
  });

  it('load_crateWhoseRegistryIsDown_stillLoadsWithoutLatestVersions', async () => {
    // Arrange
    writeFileSync(
      path.join(root, 'Cargo.toml'),
      '[package]\nname = "app"\n[dependencies]\nserde = "1"\n',
    );

    // Act
    const response: Awaited<ReturnType<CargoEndpointHandler['handle']>> = await handler.handle({
      id: 3,
      op: 'load',
      root,
    });

    // Assert
    expect(response).toMatchObject({
      ok: true,
      result: {
        ecosystem: 'cargo',
        projects: [{ name: 'app', packages: [{ name: 'serde', latest: null, status: 'unknown' }] }],
      },
    });
  });

  it('sources_namesCratesIo', async () => {
    // Arrange
    const request: { id: number; op: string; root: string } = { id: 4, op: 'sources', root };

    // Act
    const response: Awaited<ReturnType<CargoEndpointHandler['handle']>> =
      await handler.handle(request);

    // Assert
    expect(response).toEqual({ id: 4, ok: true, result: { sources: [{ name: 'crates.io' }] } });
  });

  it('install_nameThatReadsAsAnOption_failsTheRequest', async () => {
    // Arrange
    writeFileSync(path.join(root, 'Cargo.toml'), '[package]\nname = "app"\n');

    // Act
    const response: Awaited<ReturnType<CargoEndpointHandler['handle']>> = await handler.handle({
      id: 5,
      op: 'install',
      root,
      params: { project: path.join(root, 'Cargo.toml'), name: '--offline', version: null },
    });

    // Assert
    expect(response).toEqual({ id: 5, ok: false, error: "'--offline' is not a crate name." });
  });

  it('anOperationWithoutAFolder_failsTheRequest', async () => {
    // Arrange
    const request: { id: number; op: string } = { id: 6, op: 'load' };

    // Act
    const response: Awaited<ReturnType<CargoEndpointHandler['handle']>> =
      await handler.handle(request);

    // Assert
    expect(response).toEqual({ id: 6, ok: false, error: 'load needs a folder.' });
  });

  it('anUnknownOperation_failsTheRequest', async () => {
    // Arrange
    const request: { id: number; op: string; root: string } = { id: 7, op: 'publish', root };

    // Act
    const response: Awaited<ReturnType<CargoEndpointHandler['handle']>> =
      await handler.handle(request);

    // Assert
    expect(response).toMatchObject({ id: 7, ok: false });
  });
});
