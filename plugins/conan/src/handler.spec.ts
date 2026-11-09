import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConanEndpointHandler } from './handler';
import type { HttpFetch } from './protocol';

/**
 * A fetch that must never be called: nothing here reaches a remote.
 */
const NO_NETWORK: HttpFetch = (): Promise<never> => Promise.reject(new Error('no network'));

describe('ConanEndpointHandler', () => {
  let root: string = '';
  let handler: ConanEndpointHandler;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), 'studio-conan-handler-')));
    // The user's own Conan home holds remote credentials, and has no place in a spec.
    handler = new ConanEndpointHandler(NO_NETWORK, () => Promise.resolve(null), { HOME: root });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('initialize_advertisesOnlyWhatConanHas', async () => {
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
        capabilities: ['sources', 'search', 'searchRequiresQuery', 'restore'],
        toolVersion: null,
      },
    });
  });

  it('load_withTheRemotesUnreachable_stillListsTheRequirements', async () => {
    // Arrange
    writeFileSync(path.join(root, 'conanfile.txt'), '[requires]\nfmt/10.2.1\n');

    // Act
    const response: unknown = await handler.handle({ id: 2, op: 'load', root });

    // Assert
    expect(response).toMatchObject({
      ok: true,
      result: {
        ecosystem: 'conan',
        projects: [{ packages: [{ name: 'fmt', installed: '10.2.1', latest: null }] }],
      },
    });
  });

  it('search_theRemoteUnreachable_failsInTheUsersTerms', async () => {
    // Arrange
    const params: Record<string, unknown> = {
      source: 'conancenter',
      query: 'fmt',
      skip: 0,
      take: 5,
    };

    // Act
    const response: unknown = await handler.handle({ id: 3, op: 'search', root, params });

    // Assert
    expect(response).toEqual({
      id: 3,
      ok: false,
      error: 'The Conan remote conancenter could not be searched.',
    });
  });

  it('restore_isConanInstallAndRunsNothing', async () => {
    // Arrange
    const project: string = path.join(root, 'conanfile.py');

    // Act
    const response: unknown = await handler.handle({
      id: 4,
      op: 'restore',
      root,
      params: { project },
    });

    // Assert
    expect(response).toEqual({
      id: 4,
      ok: true,
      result: {
        executable: 'conan',
        args: ['install', '.'],
        cwd: root,
        title: 'Install Conan dependencies',
      },
    });
  });

  it('installUpdateRemove_sayConanHasNoSuchCommand', async () => {
    // Arrange
    const params: Record<string, unknown> = {
      project: path.join(root, 'conanfile.txt'),
      name: 'fmt',
    };

    // Act
    const responses: readonly unknown[] = await Promise.all(
      ['install', 'update', 'remove'].map((op: string, index: number): Promise<unknown> =>
        handler.handle({ id: 10 + index, op, root, params }),
      ),
    );

    // Assert
    for (const response of responses) {
      expect(response).toMatchObject({
        ok: false,
        error: expect.stringContaining('edit the conanfile') as unknown,
      });
    }
  });
});
