import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NpmEndpointHandler } from './handler';
import type { HttpFetch } from './protocol';

/**
 * A fetch that must never be called: nothing here reaches a registry.
 */
const NO_NETWORK: HttpFetch = (): Promise<never> => Promise.reject(new Error('no network'));

describe('NpmEndpointHandler', () => {
  let root: string = '';
  let handler: NpmEndpointHandler;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), 'studio-npm-handler-')));
    // The user's own `.npmrc` holds their tokens, and has no place in a spec.
    vi.stubEnv('HOME', root);
    vi.stubEnv('USERPROFILE', root);
    handler = new NpmEndpointHandler(NO_NETWORK, () => Promise.resolve(null), {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it('initialize_advertisesSearchThatNeedsTextAndNoPrerelease', async () => {
    await expect(handler.handle({ id: 1, op: 'initialize' })).resolves.toMatchObject({
      id: 1,
      ok: true,
      result: {
        protocol: '1.0',
        capabilities: expect.arrayContaining(['search', 'searchRequiresQuery']) as unknown,
      },
    });
    await expect(handler.handle({ id: 1, op: 'initialize' })).resolves.not.toMatchObject({
      result: { capabilities: expect.arrayContaining(['prerelease']) as unknown },
    });
  });

  it('load_answersNullForAFolderWithNoManifest', async () => {
    await expect(handler.handle({ id: 2, op: 'load', root })).resolves.toEqual({
      id: 2,
      ok: true,
      result: null,
    });
  });

  it('sources_namesThePublicRegistry', async () => {
    await expect(handler.handle({ id: 3, op: 'sources', root })).resolves.toEqual({
      id: 3,
      ok: true,
      result: { sources: [{ name: 'npm' }] },
    });
  });

  it('install_usesTheToolWhoseLockfileThereIs', async () => {
    writeFileSync(path.join(root, 'pnpm-lock.yaml'), '');

    await expect(
      handler.handle({
        id: 4,
        op: 'install',
        root,
        params: { project: path.join(root, 'package.json'), name: 'a', version: null },
      }),
    ).resolves.toMatchObject({
      ok: true,
      result: { executable: 'pnpm', args: ['add', 'a'], title: 'Install a' },
    });
  });

  it('update_saysItIsAnUpdate', async () => {
    await expect(
      handler.handle({
        id: 5,
        op: 'update',
        root,
        params: { project: path.join(root, 'package.json'), name: 'a', version: '2.0.0' },
      }),
    ).resolves.toMatchObject({
      result: { args: ['install', 'a@2.0.0'], title: 'Update a' },
    });
  });

  it('restore_answersACommand', async () => {
    await expect(
      handler.handle({
        id: 6,
        op: 'restore',
        root,
        params: { project: path.join(root, 'package.json') },
      }),
    ).resolves.toMatchObject({ ok: true, result: { executable: 'npm', args: ['install'] } });
  });

  it('remove_failsForANameReadAsAnOption', async () => {
    await expect(
      handler.handle({
        id: 7,
        op: 'remove',
        root,
        params: { project: path.join(root, 'package.json'), name: '--global' },
      }),
    ).resolves.toMatchObject({ id: 7, ok: false });
  });

  it('failsAnOperationItDoesNotKnow', async () => {
    await expect(handler.handle({ id: 8, op: 'publish', root })).resolves.toMatchObject({
      ok: false,
    });
  });

  it('failsARequestNamingNoFolder', async () => {
    await expect(handler.handle({ id: 9, op: 'load' })).resolves.toMatchObject({ ok: false });
  });
});
