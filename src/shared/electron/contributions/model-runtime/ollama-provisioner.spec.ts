import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RuntimeInstallation, RuntimeInstallProgress } from '@shared/api/model-runtime-types';
import { OLLAMA_VERSION } from './ollama-assets';
import { OllamaProvisioner, parseVersion } from './ollama-provisioner';

/**
 * A scratch directory for each test, holding the fake binaries detection is pointed at.
 */
let scratch: string = '';

beforeEach(async (): Promise<void> => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'ollama-provisioner-'));
});

afterEach(async (): Promise<void> => {
  await fs.rm(scratch, { recursive: true, force: true });
});

/**
 * Creates an empty file, making its parent directories as needed.
 */
async function touch(file: string): Promise<string> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, '');
  return file;
}

describe('OllamaProvisioner.detect', () => {
  it('reports absent when there is no binary anywhere', async () => {
    const provisioner: OllamaProvisioner = new OllamaProvisioner(
      path.join(scratch, 'root'),
      'linux',
      'x64',
      { PATH: path.join(scratch, 'empty') },
      [],
    );

    expect(await provisioner.detect()).toEqual({ kind: 'absent', executable: '', version: '' });
  });

  it('falls back to a standard install location when the binary is not on the PATH', async () => {
    const installed: string = await touch(path.join(scratch, 'usr-local-bin', 'ollama'));
    const provisioner: OllamaProvisioner = new OllamaProvisioner(
      path.join(scratch, 'root'),
      'linux',
      'x64',
      { PATH: path.join(scratch, 'empty') },
      [path.join(scratch, 'nowhere', 'ollama'), installed],
    );

    const installation: RuntimeInstallation = await provisioner.detect();

    expect(installation.kind).toBe('system');
    expect(installation.executable).toBe(installed);
  });

  it('finds a binary on the PATH and calls it a system install', async () => {
    const binDir: string = path.join(scratch, 'bin');
    const executable: string = await touch(path.join(binDir, 'ollama'));
    const provisioner: OllamaProvisioner = new OllamaProvisioner(
      path.join(scratch, 'root'),
      'linux',
      'x64',
      { PATH: `${path.join(scratch, 'nope')}:${binDir}` },
    );

    const installation: RuntimeInstallation = await provisioner.detect();

    expect(installation.kind).toBe('system');
    expect(installation.executable).toBe(executable);
  });

  it('honours an explicit OLLAMA_EXECUTABLE override ahead of the PATH', async () => {
    const override: string = await touch(path.join(scratch, 'custom', 'ollama'));
    const binDir: string = path.join(scratch, 'bin');
    await touch(path.join(binDir, 'ollama'));
    const provisioner: OllamaProvisioner = new OllamaProvisioner(
      path.join(scratch, 'root'),
      'linux',
      'x64',
      { PATH: binDir, OLLAMA_EXECUTABLE: override },
    );

    expect((await provisioner.detect()).executable).toBe(override);
  });

  it('ignores an OLLAMA_EXECUTABLE override that does not exist', async () => {
    const binDir: string = path.join(scratch, 'bin');
    const onPath: string = await touch(path.join(binDir, 'ollama'));
    const provisioner: OllamaProvisioner = new OllamaProvisioner(
      path.join(scratch, 'root'),
      'linux',
      'x64',
      { PATH: binDir, OLLAMA_EXECUTABLE: path.join(scratch, 'ghost') },
    );

    expect((await provisioner.detect()).executable).toBe(onPath);
  });

  it('falls back to the managed copy when there is no system install', async () => {
    const root: string = path.join(scratch, 'root');
    const provisioner: OllamaProvisioner = new OllamaProvisioner(
      root,
      'linux',
      'x64',
      { PATH: path.join(scratch, 'empty') },
      [],
    );
    await touch(provisioner.managedExecutable());

    const installation: RuntimeInstallation = await provisioner.detect();

    expect(installation.kind).toBe('managed');
    expect(installation.executable).toBe(provisioner.managedExecutable());
  });

  it('prefers a system install over a managed one, so no second copy is ever used', async () => {
    const root: string = path.join(scratch, 'root');
    const binDir: string = path.join(scratch, 'bin');
    const system: string = await touch(path.join(binDir, 'ollama'));
    const provisioner: OllamaProvisioner = new OllamaProvisioner(root, 'linux', 'x64', {
      PATH: binDir,
    });
    await touch(provisioner.managedExecutable());

    const installation: RuntimeInstallation = await provisioner.detect();

    expect(installation.kind).toBe('system');
    expect(installation.executable).toBe(system);
  });

  it('splits the PATH with the platform separator on Windows', async () => {
    const binDir: string = path.join(scratch, 'winbin');
    const executable: string = await touch(path.join(binDir, 'ollama.exe'));
    const provisioner: OllamaProvisioner = new OllamaProvisioner(
      path.join(scratch, 'root'),
      'win32',
      'x64',
      { PATH: `C:\\nope;${binDir}` },
    );

    expect((await provisioner.detect()).executable).toBe(executable);
  });
});

describe('OllamaProvisioner.managedExecutable', () => {
  it('scopes the install directory by version and platform, so a bump installs fresh', () => {
    const provisioner: OllamaProvisioner = new OllamaProvisioner('/root', 'linux', 'arm64', {});

    expect(provisioner.managedExecutable()).toBe(
      path.join('/root', OLLAMA_VERSION, 'linux-arm64', 'ollama'),
    );
  });
});

describe('OllamaProvisioner.install', () => {
  it('fails cleanly on a platform Studio cannot provision, rather than throwing', async () => {
    const provisioner: OllamaProvisioner = new OllamaProvisioner(
      path.join(scratch, 'root'),
      'freebsd',
      'x64',
      {},
    );
    const progress: RuntimeInstallProgress[] = [];

    const installation: RuntimeInstallation = await provisioner.install((p): void => {
      progress.push(p);
    });

    expect(installation.kind).toBe('absent');
    expect(progress.at(-1)?.stage).toBe('failed');
    expect(progress.at(-1)?.error).toContain('freebsd');
  });

  it('reuses an already-installed managed copy without downloading', async () => {
    const provisioner: OllamaProvisioner = new OllamaProvisioner(
      path.join(scratch, 'root'),
      'linux',
      'x64',
      {},
    );
    await touch(provisioner.managedExecutable());
    const progress: RuntimeInstallProgress[] = [];

    const installation: RuntimeInstallation = await provisioner.install((p): void => {
      progress.push(p);
    });

    expect(installation.kind).toBe('managed');
    expect(progress.map((p: RuntimeInstallProgress): string => p.stage)).toEqual(['done']);
  });

  it('shares one install across concurrent callers', async () => {
    const provisioner: OllamaProvisioner = new OllamaProvisioner(
      path.join(scratch, 'root'),
      'linux',
      'x64',
      {},
    );
    await touch(provisioner.managedExecutable());

    const [first, second]: RuntimeInstallation[] = await Promise.all([
      provisioner.install(),
      provisioner.install(),
    ]);

    expect(first).toBe(second);
  });
});

describe('parseVersion', () => {
  it('reads the version out of the CLI banner', () => {
    expect(parseVersion('ollama version is 0.32.14')).toBe('0.32.14');
  });

  it('reads it even when a warning precedes it, which is what a stopped server prints', () => {
    expect(
      parseVersion(
        'Warning: could not connect to a running Ollama instance\nWarning: client version is 0.30.10\n',
      ),
    ).toBe('0.30.10');
  });

  it('returns an empty string when there is no version to find', () => {
    expect(parseVersion('command not found')).toBe('');
  });
});
