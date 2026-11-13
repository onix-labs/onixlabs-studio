import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { ProjectItemNode, ProjectItems, ProjectModel } from '@shared/api/project-system';
import {
  cargoMetadataArguments,
  crateSourceDirectories,
  parseCargoTargetSources,
} from './cargo-metadata';
import {
  parseCargoPackageName,
  parseCargoWorkspaceMembers,
  RustProjectSystem,
} from './rust-project-system';

describe('parseCargoPackageName', () => {
  it('readsThePackageTableName', () => {
    const toml: string = ['[package]', 'name = "my-crate"', 'version = "0.1.0"'].join('\n');
    expect(parseCargoPackageName(toml)).toBe('my-crate');
  });

  it('returnsNullForAVirtualWorkspaceRootWithNoPackage', () => {
    const toml: string = ['[workspace]', 'members = ["a", "b"]'].join('\n');
    expect(parseCargoPackageName(toml)).toBeNull();
    expect(parseCargoPackageName(null)).toBeNull();
  });

  it('doesNotReadANameFromAnotherTable', () => {
    const toml: string = ['[package]', 'version = "1"', '', '[dependencies]', 'name = "x"'].join(
      '\n',
    );
    expect(parseCargoPackageName(toml)).toBeNull();
  });
});

describe('parseCargoWorkspaceMembers', () => {
  it('readsAMultilineMembersArray', () => {
    const toml: string = [
      '[workspace]',
      'members = [',
      '  "crates/core",',
      '  "crates/cli",',
      ']',
    ].join('\n');
    expect(parseCargoWorkspaceMembers(toml)).toEqual(['crates/core', 'crates/cli']);
  });

  it('readsAnInlineMembersArrayWithWildcards', () => {
    expect(parseCargoWorkspaceMembers('[workspace]\nmembers = ["crates/*"]')).toEqual(['crates/*']);
  });

  it('returnsEmptyWhenAbsent', () => {
    expect(parseCargoWorkspaceMembers(null)).toEqual([]);
    expect(parseCargoWorkspaceMembers('[package]\nname = "x"')).toEqual([]);
  });
});

describe('RustProjectSystem', () => {
  const provider: RustProjectSystem = new RustProjectSystem();

  it('declaresTheRustKindWithDevReleaseAndATargetTripleAxis', () => {
    expect(provider.kind).toBe('rust');
    expect(provider.capabilities.actions).toEqual(['build', 'clean', 'rebuild']);
    expect(
      provider.capabilities.buildConfigurations.map((c: { id: string }): string => c.id),
    ).toEqual(['dev', 'release']);
    expect(provider.capabilities.target?.kind).toBe('target-triple');
    // CodeLLDB, which the Plugin Manager installs (#1210).
    expect(provider.capabilities.debug).toEqual({ adapter: 'codelldb' });
  });

  it('ownsCargoManifestsOnly', () => {
    expect(provider.ownsProject('/w/Cargo.toml')).toBe(true);
    expect(provider.ownsProject('/w/Cargo.lock')).toBe(false);
    expect(provider.ownsProject('/w/main.rs')).toBe(false);
  });
});

const fixtures: string[] = [];

afterEach(() => {
  for (const root of fixtures.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * Writes a tree of files under a new temporary directory.
 * @param files The files' contents, by relative path.
 * @returns Returns the directory.
 */
function fixture(files: Readonly<Record<string, string>>): string {
  const root: string = realpathSync(mkdtempSync(path.join(tmpdir(), 'studio-project-')));
  fixtures.push(root);
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), content);
  }
  return root;
}

/**
 * Lists the paths of a project tree, folders first.
 * @param nodes The tree.
 * @returns Returns the names, indented by depth.
 */
function names(nodes: readonly ProjectItemNode[], depth: number = 0): string[] {
  return nodes.flatMap((node: ProjectItemNode): string[] => [
    `${' '.repeat(depth)}${node.name}`,
    ...(node.type === 'folder' ? names(node.children, depth + 1) : []),
  ]);
}

describe('RustProjectSystem on disk', () => {
  const provider: RustProjectSystem = new RustProjectSystem();

  it('readsWorkspaceMembers_notDefaultMembers_whichComeFirst', () => {
    expect(
      parseCargoWorkspaceMembers(
        '[workspace]\ndefault-members = ["a"]\nmembers = ["a", "b"]\nexclude = ["c"]',
      ),
    ).toEqual(['a', 'b']);
  });

  it('readsAManifestWithWindowsLineEndings', () => {
    expect(parseCargoPackageName('[package]\r\nname = "crate"\r\n')).toBe('crate');
  });

  it('detectsAManifest_butNotADirectoryOfThatName', async () => {
    expect(await provider.detect(fixture({ 'Cargo.toml': '[package]\nname = "a"' }))).toBe(true);
    expect(await provider.detect(fixture({ 'Cargo.toml/x': '' }))).toBe(false);
    expect(await provider.detect(fixture({}))).toBe(false);
  });

  it('isNull_withNoReadableManifest', async () => {
    expect(await provider.load(fixture({}))).toBeNull();
  });

  it('loadsASingleCrate_namedByItsFolderWhenItHasNoName', async () => {
    const root: string = fixture({ 'Cargo.toml': '# nothing useful' });

    const model: ProjectModel | null = await provider.load(root);

    expect(model?.solution).toBeNull();
    expect(model?.projects).toEqual([
      { name: path.basename(root), path: path.join(root, 'Cargo.toml') },
    ]);
  });

  it('expandsWildcardMembers_skippingWhatHoldsNoManifest', async () => {
    const root: string = fixture({
      'Cargo.toml': '[workspace]\nmembers = ["crates/*", "tools/one", "gone/*", "absent"]',
      'crates/zed/Cargo.toml': '[package]\nname = "zed"',
      'crates/alpha/Cargo.toml': '# unnamed',
      'crates/empty/readme.md': '',
      'crates/file.txt': '',
      'tools/one/Cargo.toml': '[package]\nname = "one"',
    });

    const model: ProjectModel | null = await provider.load(root);

    expect(model?.projects.map((entry: { name: string }): string => entry.name)).toEqual([
      'alpha',
      'one',
      'zed',
    ]);
    expect(model?.solution?.path).toBe(path.join(root, 'Cargo.toml'));
  });

  it('countsARootThatIsBothAPackageAndAWorkspace_asACrateToo', async () => {
    const root: string = fixture({
      'Cargo.toml': '[package]\nname = "root"\n[workspace]\nmembers = ["a"]',
      'a/Cargo.toml': '[package]\nname = "a"',
    });

    const model: ProjectModel | null = await provider.load(root);

    expect(model?.projects.map((entry: { name: string }): string => entry.name)).toEqual([
      'root',
      'a',
    ]);
  });

  it('listsAProjectsItems_foldersFirst_skippingBuildOutputAndDotFolders', async () => {
    const root: string = fixture({
      'Cargo.toml': '',
      'src/main.rs': '',
      'target/debug/app': '',
      '.git/config': '',
      'empty/.keep/x': '',
    });

    const items: ProjectItems | null = await provider.loadProjectItems(
      path.join(root, 'Cargo.toml'),
    );

    expect(names(items?.tree ?? [])).toEqual(['src', ' main.rs', 'Cargo.toml']);
  });

  it('isNull_forItemsOfAProjectWhoseFolderHasGone', async () => {
    expect(await provider.loadProjectItems('/no/such/place/Cargo.toml')).toBeNull();
  });
});

/**
 * Reads a contents tree as slash-joined paths, folders marked with a trailing slash.
 * @param nodes The tree.
 * @param prefix The path so far.
 * @returns Returns every node's path, depth-first.
 */
function flat(nodes: readonly ProjectItemNode[], prefix: string = ''): string[] {
  return nodes.flatMap((node: ProjectItemNode): string[] =>
    node.type === 'folder'
      ? [`${prefix}${node.name}/`, ...flat(node.children, `${prefix}${node.name}/`)]
      : [`${prefix}${node.name}`],
  );
}

describe('cargoMetadataArguments (#899)', () => {
  it('readsTheManifestsAlone', () => {
    const args: readonly string[] = cargoMetadataArguments('/c/Cargo.toml');

    expect(args).toContain('--no-deps');
    expect(args).toContain('--offline');
    expect(args.slice(-2)).toEqual(['--manifest-path', '/c/Cargo.toml']);
  });
});

describe('parseCargoTargetSources (#899)', () => {
  const output: string = JSON.stringify({
    packages: [
      { manifest_path: '/w/other/Cargo.toml', targets: [{ src_path: '/w/other/src/lib.rs' }] },
      {
        manifest_path: '/w/Cargo.toml',
        targets: [{ src_path: '/w/src/lib.rs' }, { src_path: '/w/tests/it.rs' }, {}],
      },
    ],
  });

  it('readsTheCratesOwnTargets_outOfTheWorkspace', () => {
    expect(parseCargoTargetSources(output, '/w/Cargo.toml')).toEqual([
      '/w/src/lib.rs',
      '/w/tests/it.rs',
    ]);
  });

  it('isNull_whenTheOutputDoesNotDescribeTheCrate', () => {
    expect(parseCargoTargetSources(output, '/elsewhere/Cargo.toml')).toBeNull();
    expect(parseCargoTargetSources('{"packages": 1}', '/w/Cargo.toml')).toBeNull();
    expect(parseCargoTargetSources('null', '/w/Cargo.toml')).toBeNull();
    expect(parseCargoTargetSources('not json', '/w/Cargo.toml')).toBeNull();
  });
});

describe('crateSourceDirectories (#899)', () => {
  const crate: string = path.resolve('/c');

  /**
   * Resolves a path under the crate.
   * @param relative The relative path.
   * @returns Returns the absolute path.
   */
  function under(relative: string): string {
    return path.join(crate, relative);
  }

  it('keepsEachTargetsDirectory_droppingThoseInsideAnother', () => {
    expect(
      crateSourceDirectories(crate, [
        under('src/lib.rs'),
        under('src/main.rs'),
        under('src/bin/tool.rs'),
        under('tests/it.rs'),
      ]),
    ).toEqual([under('src'), under('tests')]);
  });

  it('neverListsTheCratesOwnFolder_orOneOutsideIt', () => {
    expect(
      crateSourceDirectories(crate, [under('build.rs'), path.resolve('/elsewhere/lib.rs')]),
    ).toEqual([]);
  });
});

describe.skipIf(process.platform === 'win32')('RustProjectSystem.loadProjectItems (#899)', () => {
  let scratch: string = '';
  let bin: string = '';
  let root: string = '';

  beforeEach(() => {
    scratch = realpathSync(mkdtempSync(path.join(tmpdir(), 'studio-cargo-')));
    bin = path.join(scratch, 'bin');
    root = path.join(scratch, 'crate');
    mkdirSync(bin);
    vi.stubEnv('CARGO_HOME', path.join(scratch, 'no-cargo-home'));
    vi.stubEnv('PATH', `${bin}${path.delimiter}/usr/bin${path.delimiter}/bin`);
    for (const file of [
      'Cargo.toml',
      'Cargo.lock',
      'build.rs',
      'src/lib.rs',
      'src/net/mod.rs',
      'src/bin/tool.rs',
      'tests/common/mod.rs',
      'tests/it.rs',
      'crates/member/src/lib.rs',
      'output/run.log',
      'notes.txt',
      'target/debug/app',
    ]) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), '');
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(scratch, { recursive: true, force: true });
  });

  /**
   * Puts a fake `cargo` in place.
   * @param body The shell script's body.
   */
  function cargo(body: string): void {
    const file: string = path.join(bin, 'cargo');
    writeFileSync(
      file,
      `#!/bin/sh\n{ pwd; echo "$@"; echo "$RUSTUP_AUTO_INSTALL"; } > "${file}.log"\n${body}\n`,
    );
    chmodSync(file, 0o755);
  }

  /**
   * The output of a fake `cargo` that names the crate's targets.
   * @returns Returns the script line.
   */
  function answer(): string {
    const metadata: object = {
      packages: [
        {
          manifest_path: path.join(root, 'Cargo.toml'),
          targets: ['src/lib.rs', 'src/bin/tool.rs', 'tests/it.rs', 'build.rs'].map(
            (source: string): object => ({ src_path: path.join(root, source) }),
          ),
        },
      ],
    };
    return `echo '${JSON.stringify(metadata)}'`;
  }

  it('listsWhatTheTargetsAreMadeOf_leavingEverythingElseToTheFileExplorer', async () => {
    cargo(answer());

    const items: ProjectItems | null = await new RustProjectSystem().loadProjectItems(
      path.join(root, 'Cargo.toml'),
    );

    expect(flat(items!.tree)).toEqual([
      'src/',
      'src/bin/',
      'src/bin/tool.rs',
      'src/net/',
      'src/net/mod.rs',
      'src/lib.rs',
      'tests/',
      'tests/common/',
      'tests/common/mod.rs',
      'tests/it.rs',
      'build.rs',
      'Cargo.lock',
      'Cargo.toml',
    ]);
  });

  it('asksFromOutsideTheWorkspace_soNothingInItPicksTheToolchain', async () => {
    cargo(answer());

    await new RustProjectSystem().loadProjectItems(path.join(root, 'Cargo.toml'));

    const [cwd, args, autoInstall]: string[] = readFileSync(
      path.join(bin, 'cargo.log'),
      'utf8',
    ).split('\n');
    expect(cwd.startsWith(root)).toBe(false);
    expect(args).toContain(`--manifest-path ${path.join(root, 'Cargo.toml')}`);
    expect(autoInstall).toBe('0');
  });

  it('placesFilesUnderTheWorkspacesOwnPath_whenItIsReachedThroughALink', async () => {
    const link: string = path.join(scratch, 'link');
    symlinkSync(root, link);
    cargo(answer());

    const items: ProjectItems | null = await new RustProjectSystem().loadProjectItems(
      path.join(link, 'Cargo.toml'),
    );

    expect(items!.tree.at(-1)).toMatchObject({ path: path.join(link, 'Cargo.toml') });
  });

  it('keepsTheEntryPoints_whenFixturesSpendTheBudget', async () => {
    mkdirSync(path.join(root, 'src', 'a'));
    for (let index: number = 0; index < 5_100; index += 1) {
      writeFileSync(path.join(root, 'src', 'a', `${index}.json`), '');
    }
    cargo(answer());

    const items: ProjectItems | null = await new RustProjectSystem().loadProjectItems(
      path.join(root, 'Cargo.toml'),
    );

    expect(flat(items!.tree)).toEqual(
      expect.arrayContaining(['src/lib.rs', 'src/bin/tool.rs', 'tests/it.rs', 'build.rs']),
    );
  });

  it.each([
    ['cargo fails', 'echo nope >&2; exit 101'],
    ['the output is garbage', 'echo nonsense'],
    ['the crate is not in the answer', `echo '{"packages": []}'`],
    ['the crate has no targets', 'NO_TARGETS'],
  ])('fallsBackToTheListing_when %s', async (_name: string, body: string) => {
    const empty: string = JSON.stringify({
      packages: [{ manifest_path: path.join(root, 'Cargo.toml'), targets: [] }],
    });
    cargo(body === 'NO_TARGETS' ? `echo '${empty}'` : body);

    const items: ProjectItems | null = await new RustProjectSystem().loadProjectItems(
      path.join(root, 'Cargo.toml'),
    );

    // The crate's Rust sources from the tree, outside any target included; notes and logs are left
    // to the File Explorer (#899).
    expect(flat(items!.tree)).toEqual(
      expect.arrayContaining(['crates/member/src/lib.rs', 'src/lib.rs', 'Cargo.toml']),
    );
    expect(flat(items!.tree)).not.toContain('notes.txt');
    expect(flat(items!.tree)).not.toContain('output/run.log');
  });

  it('fallsBackToTheListing_whenThereIsNoCargo', async () => {
    // Nothing but the empty folder: a machine can have a real `cargo` in /usr/bin.
    vi.stubEnv('PATH', bin);

    const items: ProjectItems | null = await new RustProjectSystem().loadProjectItems(
      path.join(root, 'Cargo.toml'),
    );

    expect(flat(items!.tree)).toContain('crates/member/src/lib.rs');
  });

  it('triesCargoHome_afterThePath', async () => {
    const home: string = path.join(scratch, 'cargo-home');
    mkdirSync(path.join(home, 'bin'), { recursive: true });
    vi.stubEnv('CARGO_HOME', home);
    const file: string = path.join(home, 'bin', 'cargo');
    writeFileSync(file, `#!/bin/sh\n${answer()}\n`);
    chmodSync(file, 0o755);

    const items: ProjectItems | null = await new RustProjectSystem().loadProjectItems(
      path.join(root, 'Cargo.toml'),
    );

    // Cargo answered: only the targets' sources, never the fallback's walk of the tree.
    expect(flat(items!.tree)).not.toContain('crates/member/src/lib.rs');
  });
});
