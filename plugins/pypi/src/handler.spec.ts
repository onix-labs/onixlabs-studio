import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PypiEndpointHandler, PypiResponse } from './handler';
import type { HttpFetch } from './protocol';

/**
 * A fetch that must never be called: nothing here reaches an index.
 */
const NO_NETWORK: HttpFetch = (): Promise<never> => Promise.reject(new Error('no network'));

describe('PypiEndpointHandler', () => {
  let root: string = '';
  let handler: PypiEndpointHandler;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), 'studio-pypi-handler-')));
    // ⛔ The user's own pip.conf has no place in a spec.
    vi.stubEnv('HOME', path.join(root, 'home'));
    vi.stubEnv('USERPROFILE', path.join(root, 'home'));
    handler = new PypiEndpointHandler(NO_NETWORK, () => Promise.resolve(null), {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it('initialize_advertisesExactNameLookupAndNoPrerelease', async () => {
    // Act
    const response: PypiResponse = await handler.handle({ id: 1, op: 'initialize' });

    // Assert
    expect(response).toMatchObject({
      ok: true,
      result: {
        protocol: '1.1',
        capabilities: expect.arrayContaining(['search', 'searchExactName']) as unknown,
      },
    });
    expect(response).not.toMatchObject({
      result: { capabilities: expect.arrayContaining(['prerelease']) as unknown },
    });
  });

  it('load_aFolderWithNoProject_answersNull', async () => {
    // Act
    const response: PypiResponse = await handler.handle({ id: 2, op: 'load', root });

    // Assert
    expect(response).toEqual({ id: 2, ok: true, result: null });
  });

  it('sources_namesPypi', async () => {
    // Act
    const response: PypiResponse = await handler.handle({ id: 3, op: 'sources', root });

    // Assert
    expect(response).toEqual({ id: 3, ok: true, result: { sources: [{ name: 'PyPI' }] } });
  });

  it('update_aPackageInAUvGroup_keepsItInThatGroup', async () => {
    // Arrange
    writeFileSync(
      path.join(root, 'pyproject.toml'),
      '[project]\nname = "a"\n[dependency-groups]\ntest = ["PyTest>=8"]\n',
    );
    writeFileSync(path.join(root, 'uv.lock'), '');

    // Act
    const response: PypiResponse = await handler.handle({
      id: 4,
      op: 'update',
      root,
      params: { project: path.join(root, 'pyproject.toml'), name: 'pytest', version: '8.3.0' },
    });

    // Assert
    expect(response).toMatchObject({
      ok: true,
      result: {
        executable: 'uv',
        args: ['add', '--group', 'test', 'pytest==8.3.0'],
        cwd: root,
        title: 'Update pytest',
      },
    });
  });

  it('install_aRequirementsFile_answersWhyNotInTheUsersTerms', async () => {
    // Arrange
    writeFileSync(path.join(root, 'requirements.txt'), 'requests\n');

    // Act
    const response: PypiResponse = await handler.handle({
      id: 5,
      op: 'install',
      root,
      params: { project: path.join(root, 'requirements.txt'), name: 'rich', version: null },
    });

    // Assert
    expect(response).toMatchObject({
      ok: false,
      error: expect.stringContaining('pip has no command') as unknown,
    });
  });

  it('restore_aRequirementsFile_runsPipInTheProjectsEnvironment', async () => {
    // Arrange
    mkdirSync(path.join(root, 'svc'));
    writeFileSync(path.join(root, 'svc', 'requirements.txt'), 'requests\n');
    mkdirSync(path.join(root, '.venv'));
    writeFileSync(path.join(root, '.venv', 'pyvenv.cfg'), '');

    // Act
    const response: PypiResponse = await handler.handle({
      id: 6,
      op: 'restore',
      root,
      params: { project: path.join(root, 'svc', 'requirements.txt') },
    });

    // Assert
    expect(response).toMatchObject({
      ok: true,
      result: {
        args: ['-m', 'pip', 'install', '-r', 'requirements.txt'],
        cwd: path.join(root, 'svc'),
      },
    });
  });

  it.each<[string, () => string]>([
    ['outsideTheFolder', (): string => path.join(path.dirname(root), 'pyproject.toml')],
    ['relative', (): string => 'pyproject.toml'],
    ['notAManifest', (): string => path.join(root, 'notes.txt')],
    ['missing', (): string => path.join(root, 'Pipfile')],
  ])('restore_aProjectThatIs_%s_isRefused', async (_case: string, project: () => string) => {
    // Arrange
    writeFileSync(path.join(root, 'notes.txt'), '');

    // Act
    const response: PypiResponse = await handler.handle({
      id: 7,
      op: 'restore',
      root,
      params: { project: project() },
    });

    // Assert
    expect(response).toMatchObject({
      ok: false,
      error: 'That is not a Python project in this folder.',
    });
  });

  it('remove_aNameThatWouldBeReadAsAnOption_isRefused', async () => {
    // Arrange
    writeFileSync(path.join(root, 'Pipfile'), '[packages]\n');

    // Act
    const response: PypiResponse = await handler.handle({
      id: 8,
      op: 'remove',
      root,
      params: { project: path.join(root, 'Pipfile'), name: '--system' },
    });

    // Assert
    expect(response).toMatchObject({ ok: false });
  });

  it('anUnknownOperation_isAFailedRequest', async () => {
    // Act
    const response: PypiResponse = await handler.handle({ id: 9, op: 'publish', root });

    // Assert
    expect(response).toMatchObject({ id: 9, ok: false });
  });
});
