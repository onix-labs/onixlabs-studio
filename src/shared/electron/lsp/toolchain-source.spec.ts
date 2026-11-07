import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ToolchainFolders, toolchainSourcePath } from './toolchain-source';

describe('toolchainSourcePath (#1210)', () => {
  let sandbox: string;
  let folders: ToolchainFolders;

  /**
   * Writes a file below the sandbox, making its folders.
   * @param relative The file's path, relative to the sandbox.
   * @returns Returns its absolute path.
   */
  function file(relative: string): string {
    const target: string = path.join(sandbox, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, '// source');
    return target;
  }

  beforeEach(() => {
    sandbox = realpathSync(mkdtempSync(path.join(tmpdir(), 'studio-toolchain-')));
    folders = { rustup: path.join(sandbox, 'rustup'), cargo: path.join(sandbox, 'cargo') };
    mkdirSync(folders.rustup);
    mkdirSync(folders.cargo);
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  it.each([
    'rustup/toolchains/stable-x86_64/lib/rustlib/src/rust/library/core/src/option.rs',
    'cargo/registry/src/index.crates.io-abc/serde-1.0.0/src/lib.rs',
    'cargo/git/checkouts/thing-abc/def/src/lib.rs',
  ])('takes %s', async (relative: string) => {
    const target: string = file(relative);

    await expect(toolchainSourcePath(target, folders)).resolves.toBe(target);
  });

  it.each([
    // What Cargo keeps besides sources, credentials among them.
    'cargo/credentials.toml',
    'cargo/registry/src/index.crates.io-abc/serde-1.0.0/Cargo.toml',
    'cargo/config.rs',
    'cargo/registry/cache/thing.rs',
    'rustup/settings.rs',
    'rustup/toolchains/stable-x86_64/lib/other.rs',
    'rustup/toolchains/stable-x86_64/lib/rustlib/other/x.rs',
    'workspace/src/lib.rs',
  ])('refuses %s', async (relative: string) => {
    await expect(toolchainSourcePath(file(relative), folders)).resolves.toBeNull();
  });

  it('refuses a link planted among sources that names a file elsewhere', async () => {
    const secret: string = file('elsewhere/secret.rs');
    const link: string = path.join(path.dirname(file('cargo/registry/src/a/lib.rs')), 'link.rs');
    symlinkSync(secret, link);

    await expect(toolchainSourcePath(link, folders)).resolves.toBeNull();
  });

  it('refuses a link with a source name that names something else', async () => {
    const secret: string = file('cargo/registry/src/a/credentials.toml');
    const link: string = path.join(path.dirname(secret), 'link.rs');
    symlinkSync(secret, link);

    await expect(toolchainSourcePath(link, folders)).resolves.toBeNull();
  });

  it('refuses a folder climbing out of the sources', async () => {
    file('elsewhere/secret.rs');
    file('cargo/registry/src/a/lib.rs');

    await expect(
      toolchainSourcePath(
        path.join(sandbox, 'cargo/registry/src/a/../../../../elsewhere/secret.rs'),
        folders,
      ),
    ).resolves.toBeNull();
  });

  it('refuses what is not a path to a file that exists', async () => {
    await expect(toolchainSourcePath(undefined, folders)).resolves.toBeNull();
    await expect(toolchainSourcePath('relative/lib.rs', folders)).resolves.toBeNull();
    await expect(
      toolchainSourcePath(path.join(sandbox, 'cargo/registry/src/none.rs'), folders),
    ).resolves.toBeNull();
  });

  it('refuses everything when the toolchain is not there', async () => {
    const missing: ToolchainFolders = {
      rustup: path.join(sandbox, 'none'),
      cargo: path.join(sandbox, 'neither'),
    };

    await expect(
      toolchainSourcePath(file('cargo/registry/src/a/lib.rs'), missing),
    ).resolves.toBeNull();
  });
});
