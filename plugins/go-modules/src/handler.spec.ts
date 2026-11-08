import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GoEndpointHandler, GoResponse } from './handler';
import type { HttpFetch } from './protocol';

/**
 * A fetch that must never be called: nothing here reaches a proxy.
 */
const NO_NETWORK: HttpFetch = (): Promise<never> => Promise.reject(new Error('no network'));

describe('GoEndpointHandler', () => {
  let root: string = '';
  let handler: GoEndpointHandler;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), 'studio-go-handler-')));
    // ⛔ A scratch home and no go env file: the user's own Go settings have no place in a spec.
    handler = new GoEndpointHandler(NO_NETWORK, () => Promise.resolve(null), {
      HOME: root,
      GOENV: 'off',
    });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('initialize_advertisesExactNameSearchOnProtocol11', async () => {
    // Act
    const response: GoResponse = await handler.handle({ id: 1, op: 'initialize' });

    // Assert
    expect(response).toMatchObject({
      ok: true,
      result: {
        protocol: '1.1',
        toolVersion: null,
        capabilities: expect.arrayContaining(['search', 'searchExactName', 'restore']) as unknown,
      },
    });
    expect(response).not.toMatchObject({
      result: { capabilities: expect.arrayContaining(['prerelease']) as unknown },
    });
  });

  it('load_folderWithNoModule_isNull', async () => {
    await expect(handler.handle({ id: 2, op: 'load', root })).resolves.toEqual({
      id: 2,
      ok: true,
      result: null,
    });
  });

  it('load_unreachableProxy_stillListsTheModule', async () => {
    // Arrange
    writeFileSync(
      path.join(root, 'go.mod'),
      'module example.com/app\nrequire golang.org/x/mod v0.20.0\n',
    );

    // Act
    const response: GoResponse = await handler.handle({ id: 3, op: 'load', root });

    // Assert
    expect(response).toMatchObject({
      ok: true,
      result: {
        ecosystem: 'go',
        projects: [
          {
            name: 'example.com/app',
            packages: [{ name: 'golang.org/x/mod', latest: null, status: 'unknown' }],
          },
        ],
      },
    });
  });

  it('install_answersACommandAndRunsNothing', async () => {
    // Act
    const response: GoResponse = await handler.handle({
      id: 4,
      op: 'install',
      root,
      params: { project: path.join(root, 'go.mod'), name: 'golang.org/x/mod', version: null },
    });

    // Assert
    expect(response).toEqual({
      id: 4,
      ok: true,
      result: {
        executable: 'go',
        args: ['get', 'golang.org/x/mod@latest'],
        cwd: root,
        title: 'Install golang.org/x/mod',
      },
    });
  });

  it('remove_optionShapedName_isAFailedRequest', async () => {
    await expect(
      handler.handle({
        id: 5,
        op: 'remove',
        root,
        params: { project: path.join(root, 'go.mod'), name: '-modfile=x' },
      }),
    ).resolves.toMatchObject({ id: 5, ok: false });
  });

  it('unknownOperation_isAFailedRequest', async () => {
    await expect(handler.handle({ id: 6, op: 'publish', root })).resolves.toMatchObject({
      ok: false,
      error: 'publish is not an operation this plugin knows.',
    });
  });

  it('operationWithoutAFolder_isAFailedRequest', async () => {
    await expect(handler.handle({ id: 7, op: 'load' })).resolves.toMatchObject({
      ok: false,
      error: 'load needs a folder.',
    });
  });
});
