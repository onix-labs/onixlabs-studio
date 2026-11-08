import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CargoPackageManager } from './cargo';
import type {
  HttpFetch,
  HttpResponse,
  InstalledPackage,
  PackageCommand,
  PackageManagerModel,
  PackageProject,
} from './protocol';

/**
 * One request the fake registry saw.
 */
interface Seen {
  /**
   * Gets the URL.
   */
  readonly url: string;

  /**
   * Gets the Authorization header, or `none`.
   */
  readonly authorization: string;
}

/**
 * A fake registry answering sparse index files by URL, recording what it was asked.
 * @param files The index files, by URL.
 * @param seen Receives the requests.
 * @returns Returns the fetch.
 */
function registry(files: Readonly<Record<string, string>>, seen: Seen[] = []): HttpFetch {
  return (url: string, init?: { headers?: Record<string, string> }): Promise<HttpResponse> => {
    seen.push({ url, authorization: init?.headers?.['Authorization'] ?? 'none' });
    const body: string | undefined = files[url];
    return Promise.resolve({
      ok: body !== undefined,
      status: body === undefined ? 404 : 200,
      json: (): Promise<unknown> => Promise.resolve(JSON.parse(body ?? '{}')),
      text: (): Promise<string> => Promise.resolve(body ?? ''),
    });
  };
}

/**
 * Builds a sparse index file from versions.
 * @param versions The published versions.
 * @returns Returns the file.
 */
function versions(...versions: string[]): string {
  return versions.map((vers: string): string => JSON.stringify({ vers, yanked: false })).join('\n');
}

/**
 * Finds a row by name.
 * @param project The project.
 * @param name The row's name.
 * @returns Returns the row.
 */
function row(project: PackageProject | undefined, name: string): InstalledPackage | undefined {
  return project?.packages.find((entry: InstalledPackage): boolean => entry.name === name);
}

describe('CargoPackageManager', () => {
  let root: string = '';
  let home: string = '';

  /**
   * Writes a file under the fixture root, creating its folders.
   * @param relative The path below the root.
   * @param lines The file's lines.
   */
  function write(relative: string, ...lines: string[]): void {
    const file: string = path.join(root, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, lines.join('\n'));
  }

  /**
   * Writes a file under the scratch CARGO_HOME.
   * @param relative The path below it.
   * @param lines The file's lines.
   */
  function writeHome(relative: string, ...lines: string[]): void {
    writeFileSync(path.join(home, relative), lines.join('\n'));
  }

  /**
   * Writes a workspace: a virtual root with inherited dependencies, two members matched by a glob, one
   * excluded crate, and a lockfile.
   */
  function writeWorkspace(): void {
    write(
      'Cargo.toml',
      '[workspace]',
      'members = ["crates/*"]',
      'exclude = ["crates/legacy"]',
      '[workspace.dependencies]',
      'serde = { version = "1.0", features = ["derive"] }',
    );
    write(
      'crates/core/Cargo.toml',
      '[package]',
      'name = "core"',
      'version = "0.1.0"',
      '[dependencies]',
      'serde = { workspace = true }',
      'helper = { path = "../helper" }',
      'forked = { git = "https://github.com/me/forked", tag = "v1" }',
      '[dev-dependencies]',
      'proptest = "1.4"',
      "[target.'cfg(unix)'.build-dependencies]",
      'cc = "1.0"',
    );
    write(
      'crates/helper/Cargo.toml',
      '[package]',
      'name = "helper"',
      'version = "0.2.0"',
      '[dependencies]',
      'serde.workspace = true',
    );
    write(
      'crates/legacy/Cargo.toml',
      '[package]',
      'name = "legacy"',
      '[dependencies]',
      'rand = "0.7"',
    );
    write(
      'Cargo.lock',
      'version = 4',
      '[[package]]',
      'name = "core"',
      'version = "0.1.0"',
      'dependencies = ["serde", "helper", "forked", "proptest", "cc"]',
      '[[package]]',
      'name = "helper"',
      'version = "0.2.0"',
      'dependencies = ["serde"]',
      '[[package]]',
      'name = "serde"',
      'version = "1.0.190"',
      'source = "registry+https://github.com/rust-lang/crates.io-index"',
      '[[package]]',
      'name = "forked"',
      'version = "0.3.0"',
      'source = "git+https://github.com/me/forked?tag=v1#abc"',
      '[[package]]',
      'name = "proptest"',
      'version = "1.4.0"',
      'source = "registry+https://github.com/rust-lang/crates.io-index"',
    );
  }

  beforeEach(() => {
    const scratch: string = realpathSync(mkdtempSync(path.join(tmpdir(), 'studio-cargo-')));
    root = path.join(scratch, 'workspace');
    home = path.join(scratch, 'cargo-home');
    mkdirSync(root);
    mkdirSync(home);
    // The user's own ~/.cargo holds registry tokens, and has no place in a spec.
    vi.stubEnv('HOME', scratch);
    vi.stubEnv('USERPROFILE', scratch);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(path.dirname(root), { recursive: true, force: true });
  });

  it('load_aWorkspace_listsEachMemberWithInstalledAndLatestVersions', async () => {
    // Arrange
    writeWorkspace();
    const fetchFn: HttpFetch = registry({
      'https://index.crates.io/se/rd/serde': versions('1.0.190', '1.0.200', '2.0.0-beta.1'),
      'https://index.crates.io/pr/op/proptest': versions('1.4.0'),
      'https://index.crates.io/2/cc': versions('1.0.90'),
    });
    const manager: CargoPackageManager = new CargoPackageManager(undefined, { CARGO_HOME: home });

    // Act
    const model: PackageManagerModel | null = await manager.load(root, fetchFn);

    // Assert
    const core: PackageProject | undefined = model?.projects.find(
      (project: PackageProject): boolean => project.name === 'core',
    );
    expect(model?.ecosystem).toBe('cargo');
    expect(model?.projects.map((project: PackageProject): string => project.name)).toEqual([
      'core',
      'helper',
      'legacy',
    ]);
    expect(row(core, 'serde')).toEqual({
      name: 'serde',
      requested: '1.0',
      installed: '1.0.190',
      latest: '1.0.200',
      status: 'outdated',
      scope: 'production',
    });
    expect(row(core, 'proptest')).toMatchObject({ status: 'current', scope: 'development' });
    expect(row(core, 'cc')).toMatchObject({
      installed: null,
      latest: '1.0.90',
      status: 'outdated',
      scope: 'development',
    });
  });

  it('load_pathAndGitDependencies_showWhereTheyComeFromWithoutALatest', async () => {
    // Arrange
    writeWorkspace();
    const seen: Seen[] = [];
    const manager: CargoPackageManager = new CargoPackageManager(undefined, { CARGO_HOME: home });

    // Act
    const model: PackageManagerModel | null = await manager.load(root, registry({}, seen));

    // Assert
    const core: PackageProject | undefined = model?.projects[0];
    expect(row(core, 'helper')).toEqual({
      name: 'helper',
      requested: 'path ../helper',
      installed: '0.2.0',
      latest: null,
      status: 'unknown',
      scope: 'production',
    });
    expect(row(core, 'forked')).toMatchObject({
      requested: 'git github.com/me/forked (tag v1)',
      installed: '0.3.0',
      latest: null,
    });
    expect(seen.some((request: Seen): boolean => request.url.includes('forked'))).toBe(false);
    expect(seen.some((request: Seen): boolean => request.url.includes('helper'))).toBe(false);
  });

  it('load_excludedCrate_standsAloneWithoutTheWorkspaceLock', async () => {
    // Arrange
    writeWorkspace();
    const manager: CargoPackageManager = new CargoPackageManager(undefined, { CARGO_HOME: home });

    // Act
    const model: PackageManagerModel | null = await manager.load(root, registry({}));

    // Assert
    expect(row(model?.projects[2], 'rand')).toMatchObject({ requested: '0.7', installed: null });
  });

  it('load_noCrate_answersNull', async () => {
    // Arrange
    write('Cargo.toml', '[workspace]', 'members = []');
    const manager: CargoPackageManager = new CargoPackageManager(undefined, { CARGO_HOME: home });

    // Act
    const model: PackageManagerModel | null = await manager.load(root, registry({}));

    // Assert
    expect(model).toBeNull();
  });

  it('load_memberBelowTheWalk_isFoundThroughTheWorkspaceMembers', async () => {
    // Arrange
    write('Cargo.toml', '[workspace]', 'members = ["a/b/c/d/e/f/deep"]');
    write('a/b/c/d/e/f/deep/Cargo.toml', '[package]', 'name = "deep"');
    const manager: CargoPackageManager = new CargoPackageManager(undefined, { CARGO_HOME: home });

    // Act
    const model: PackageManagerModel | null = await manager.load(root, registry({}));

    // Assert
    expect(model?.projects.map((project: PackageProject): string => project.name)).toEqual([
      'deep',
    ]);
  });

  it('load_privateRegistryWithAUserCredential_sendsItWithoutAskingStudio', async () => {
    // Arrange
    write(
      'Cargo.toml',
      '[package]',
      'name = "app"',
      '[dependencies]',
      'internal = { version = "1", registry = "corp" }',
    );
    writeHome('config.toml', '[registries.corp]', 'index = "sparse+https://corp.example/index/"');
    writeHome('credentials.toml', '[registries.corp]', 'token = "from-credentials"');
    const asked: string[] = [];
    const seen: Seen[] = [];
    const manager: CargoPackageManager = new CargoPackageManager(
      (url: string): Promise<string | null> => {
        asked.push(url);
        return Promise.resolve('from-studio');
      },
      { CARGO_HOME: home },
    );

    // Act
    const model: PackageManagerModel | null = await manager.load(
      root,
      registry({ 'https://corp.example/index/in/te/internal': versions('1.2.0') }, seen),
    );

    // Assert
    expect(row(model?.projects[0], 'internal')).toMatchObject({ latest: '1.2.0' });
    expect(seen).toEqual([
      { url: 'https://corp.example/index/in/te/internal', authorization: 'from-credentials' },
    ]);
    expect(asked).toEqual([]);
  });

  it('load_projectRedirectsTheRegistry_neitherSendsTheUserTokenNorLeaksIt', async () => {
    // Arrange
    write(
      'Cargo.toml',
      '[package]',
      'name = "app"',
      '[dependencies]',
      'internal = { version = "1", registry = "corp" }',
    );
    write('.cargo/config.toml', '[registries.corp]', 'index = "sparse+https://attacker.example/"');
    writeHome('config.toml', '[registries.corp]', 'index = "sparse+https://corp.example/index/"');
    writeHome('credentials.toml', '[registries.corp]', 'token = "from-credentials"');
    const asked: string[] = [];
    const seen: Seen[] = [];
    const manager: CargoPackageManager = new CargoPackageManager(
      (url: string): Promise<string | null> => {
        asked.push(url);
        return Promise.resolve(null);
      },
      { CARGO_HOME: home },
    );

    // Act
    await manager.load(root, registry({}, seen));

    // Assert
    expect(seen).toEqual([
      { url: 'https://attacker.example/in/te/internal', authorization: 'none' },
    ]);
    // Studio is asked by URL, so a token it holds is one the user saved for that very host.
    expect(asked).toEqual(['https://attacker.example/']);
  });

  it('load_cratesIo_neverAsksStudioForAToken', async () => {
    // Arrange
    write('Cargo.toml', '[package]', 'name = "app"', '[dependencies]', 'serde = "1"');
    const asked: string[] = [];
    const manager: CargoPackageManager = new CargoPackageManager(
      (url: string): Promise<string | null> => {
        asked.push(url);
        return Promise.resolve('x');
      },
      { CARGO_HOME: home },
    );

    // Act
    await manager.load(root, registry({}));

    // Assert
    expect(asked).toEqual([]);
  });

  it('listSources_configuredRegistries_areNamedWithoutTheirUrls', async () => {
    // Arrange
    write('.cargo/config.toml', '[registries.corp]', 'index = "sparse+https://u:p@corp.example/"');
    const manager: CargoPackageManager = new CargoPackageManager(undefined, { CARGO_HOME: home });

    // Act
    const sources: readonly { name: string }[] = await manager.listSources(root);

    // Assert
    expect(sources).toEqual([{ name: 'crates.io' }, { name: 'corp' }]);
  });

  it('search_registryWithoutAnApi_answersAnHonestEmptyPage', async () => {
    // Arrange
    write(
      '.cargo/config.toml',
      '[registries.corp]',
      'index = "sparse+https://corp.example/"',
      'token = "t"',
    );
    const seen: Seen[] = [];
    const manager: CargoPackageManager = new CargoPackageManager(undefined, { CARGO_HOME: home });

    // Act
    const page: Awaited<ReturnType<CargoPackageManager['search']>> = await manager.search(
      root,
      'corp',
      'thing',
      { skip: 0, take: 10, prerelease: false },
      registry({ 'https://corp.example/config.json': '{"dl":"https://corp.example/dl"}' }, seen),
    );

    // Assert
    expect(page).toEqual({ items: [], total: 0, hasMore: false });
    expect(seen.map((request: Seen): string => request.url)).toEqual([
      'https://corp.example/config.json',
    ]);
  });

  it('search_registryWithAnApi_searchesItWithItsToken', async () => {
    // Arrange
    write(
      '.cargo/config.toml',
      '[registries.corp]',
      'index = "sparse+https://corp.example/"',
      'token = "t"',
    );
    const seen: Seen[] = [];
    const manager: CargoPackageManager = new CargoPackageManager(undefined, { CARGO_HOME: home });
    const searchUrl: string = 'https://api.corp.example/api/v1/crates?q=thing&page=1&per_page=10';

    // Act
    const page: Awaited<ReturnType<CargoPackageManager['search']>> = await manager.search(
      root,
      'corp',
      'thing',
      { skip: 0, take: 10, prerelease: false },
      registry(
        {
          'https://corp.example/config.json': '{"api":"https://api.corp.example"}',
          [searchUrl]: '{"crates":[{"name":"thing","max_version":"1.0.0"}],"meta":{"total":1}}',
        },
        seen,
      ),
    );

    // Assert
    expect(page.items[0]).toMatchObject({ name: 'thing', version: '1.0.0', sourceName: 'corp' });
    expect(seen[1]).toEqual({ url: searchUrl, authorization: 't' });
  });

  describe('writes', () => {
    beforeEach(() => {
      writeWorkspace();
    });

    it('install_aMember_addsWithCargoAdd', async () => {
      // Arrange
      const manifest: string = path.join(root, 'crates', 'core', 'Cargo.toml');
      const manager: CargoPackageManager = new CargoPackageManager(undefined, { CARGO_HOME: home });

      // Act
      const command: PackageCommand = await manager.install(root, manifest, 'anyhow', '1.0');

      // Assert
      expect(command).toEqual({
        executable: 'cargo',
        args: ['add', 'anyhow@1.0', '--manifest-path', manifest],
        cwd: path.dirname(manifest),
        title: 'Install anyhow',
      });
    });

    it('install_virtualManifest_isRefusedInTheUsersTerms', async () => {
      // Arrange
      const manager: CargoPackageManager = new CargoPackageManager(undefined, { CARGO_HOME: home });

      // Act
      const act: Promise<PackageCommand> = manager.install(
        root,
        path.join(root, 'Cargo.toml'),
        'anyhow',
        null,
      );

      // Assert
      await expect(act).rejects.toThrow(/workspace with no crate of its own/);
    });

    it('update_targetBuildDependency_movesThatEntry', async () => {
      // Arrange
      const manifest: string = path.join(root, 'crates', 'core', 'Cargo.toml');
      const manager: CargoPackageManager = new CargoPackageManager(undefined, { CARGO_HOME: home });

      // Act
      const command: PackageCommand = await manager.update(
        root,
        manifest,
        'cc',
        '1.1.0',
        registry({}),
      );

      // Assert
      expect(command.args).toEqual([
        'add',
        'cc@1.1.0',
        '--manifest-path',
        manifest,
        '--build',
        '--target',
        'cfg(unix)',
      ]);
    });

    it('update_noVersion_looksUpTheLatestBecauseCargoAddWouldNotMoveIt', async () => {
      // Arrange
      const manifest: string = path.join(root, 'crates', 'core', 'Cargo.toml');
      const manager: CargoPackageManager = new CargoPackageManager(undefined, { CARGO_HOME: home });

      // Act
      const command: PackageCommand = await manager.update(
        root,
        manifest,
        'proptest',
        null,
        registry({ 'https://index.crates.io/pr/op/proptest': versions('1.4.0', '1.5.0') }),
      );

      // Assert
      expect(command.args.slice(0, 2)).toEqual(['add', 'proptest@1.5.0']);
      expect(command.args).toContain('--dev');
    });

    it('update_inheritedPathOrGit_isRefusedInTheUsersTerms', async () => {
      // Arrange
      const manifest: string = path.join(root, 'crates', 'core', 'Cargo.toml');
      const manager: CargoPackageManager = new CargoPackageManager(undefined, { CARGO_HOME: home });

      // Act
      const inherited: Promise<PackageCommand> = manager.update(
        root,
        manifest,
        'serde',
        '2',
        registry({}),
      );
      const local: Promise<PackageCommand> = manager.update(
        root,
        manifest,
        'helper',
        '1',
        registry({}),
      );
      const forked: Promise<PackageCommand> = manager.update(
        root,
        manifest,
        'forked',
        '1',
        registry({}),
      );

      // Assert
      await expect(inherited).rejects.toThrow(/\[workspace\.dependencies\]/);
      await expect(local).rejects.toThrow(/comes from a path/);
      await expect(forked).rejects.toThrow(/comes from a git repository/);
    });

    it('remove_devDependency_removesItFromThatTable', async () => {
      // Arrange
      const manifest: string = path.join(root, 'crates', 'core', 'Cargo.toml');
      const manager: CargoPackageManager = new CargoPackageManager(undefined, { CARGO_HOME: home });

      // Act
      const command: PackageCommand = await manager.remove(root, manifest, 'proptest');

      // Assert
      expect(command.args).toEqual(['remove', 'proptest', '--manifest-path', manifest, '--dev']);
    });

    it('remove_undeclared_isRefused', async () => {
      // Arrange
      const manifest: string = path.join(root, 'crates', 'core', 'Cargo.toml');
      const manager: CargoPackageManager = new CargoPackageManager(undefined, { CARGO_HOME: home });

      // Act
      const act: Promise<PackageCommand> = manager.remove(root, manifest, 'tokio');

      // Assert
      await expect(act).rejects.toThrow(/not declared/);
    });

    it('restore_virtualManifest_fetchesTheWorkspace', async () => {
      // Arrange
      const manifest: string = path.join(root, 'Cargo.toml');
      const manager: CargoPackageManager = new CargoPackageManager(undefined, { CARGO_HOME: home });

      // Act
      const command: PackageCommand = await manager.restore(root, manifest);

      // Assert
      expect(command).toMatchObject({ args: ['fetch', '--manifest-path', manifest], cwd: root });
    });

    it('writes_manifestOutsideTheFolder_areRefused', async () => {
      // Arrange
      const outside: string = path.join(path.dirname(root), 'Cargo.toml');
      const manager: CargoPackageManager = new CargoPackageManager(undefined, { CARGO_HOME: home });

      // Act
      const act: Promise<PackageCommand> = manager.restore(root, outside);

      // Assert
      await expect(act).rejects.toThrow(/not a Cargo.toml in this folder/);
    });
  });
});
