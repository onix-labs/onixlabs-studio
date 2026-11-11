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
import { ProjectItemNode, ProjectItems } from '@shared/api/project-system';
import { buildGoPackageTree, GoPackage, goListArguments, parseGoPackages } from './go-list';
import { GoProjectSystem, parseGoModulePath } from './go-project-system';

/**
 * Reads a contents tree as slash-joined paths, folders marked with a trailing slash.
 * @param nodes The tree.
 * @param prefix The path so far.
 * @returns Returns every node's path, depth-first.
 */
function paths(nodes: readonly ProjectItemNode[], prefix: string = ''): string[] {
  return nodes.flatMap((node: ProjectItemNode): string[] =>
    node.type === 'folder'
      ? [`${prefix}${node.name}/`, ...paths(node.children, `${prefix}${node.name}/`)]
      : [`${prefix}${node.name}`],
  );
}

describe('goListArguments (#899)', () => {
  it('readsOnlyEachPackagesOwnFiles_withNoDependencyResolution', () => {
    const args: readonly string[] = goListArguments('/m');

    expect(args.slice(0, 5)).toEqual(['list', '-C', '/m', '-e', '-find']);
    expect(args.at(-1)).toBe('./...');
  });
});

describe('parseGoPackages (#899)', () => {
  it('readsConcatenatedObjects_acrossEveryFileField', () => {
    const output: string = [
      '{\n\t"Dir": "/m",\n\t"GoFiles": ["main.go"],\n\t"EmbedFiles": ["assets/one.txt"]\n}',
      '{\n\t"Dir": "/m/x",\n\t"GoFiles": ["x.go"],\n\t"IgnoredGoFiles": ["x_windows.go"],',
      '\t"TestGoFiles": ["x_test.go"],\n\t"XTestGoFiles": ["y_test.go"]\n}\n',
    ].join('\n');

    expect(parseGoPackages(output)).toEqual([
      { directory: '/m', files: ['main.go', 'assets/one.txt'] },
      { directory: '/m/x', files: ['x.go', 'x_windows.go', 'x_test.go', 'y_test.go'] },
    ]);
  });

  it('isNotConfused_byBracesAndQuotesInAPath', () => {
    expect(parseGoPackages('{"Dir": "/m/a}\\"{b", "GoFiles": ["c.go"]}')).toEqual([
      { directory: '/m/a}"{b', files: ['c.go'] },
    ]);
  });

  it('readsNoOutputAsNoPackages', () => {
    expect(parseGoPackages('')).toEqual([]);
  });

  it('isNull_forARecordItCannotRead', () => {
    expect(parseGoPackages('{"GoFiles": ["a.go"]}')).toBeNull();
    expect(parseGoPackages('{"Dir": }')).toBeNull();
  });
});

describe('buildGoPackageTree (#899)', () => {
  it('nestsThePackages_asRealFolders_besideTheModulesOwnFiles', () => {
    const packages: readonly GoPackage[] = [
      { directory: '/real/m', files: ['main.go', 'assets/one.txt'] },
      { directory: '/real/m/internal/x', files: ['x.go'] },
    ];

    const tree: readonly ProjectItemNode[] = buildGoPackageTree(
      '/link/go.mod',
      '/real/m',
      packages,
      ['go.mod', 'go.sum'],
    );

    expect(paths(tree)).toEqual([
      'assets/',
      'assets/one.txt',
      'internal/',
      'internal/x/',
      'internal/x/x.go',
      'go.mod',
      'go.sum',
      'main.go',
    ]);
    // Files open from the project's own spelling of the root, not the toolchain's resolved one.
    expect(tree[0]).toMatchObject({ path: path.resolve('/link/assets') });
  });
});

describe('parseGoModulePath', () => {
  it('readsTheModuleDirective', () => {
    expect(parseGoModulePath('module github.com/acme/widget\n\ngo 1.22')).toBe(
      'github.com/acme/widget',
    );
  });

  it('returnsNullWhenAbsent', () => {
    expect(parseGoModulePath(null)).toBeNull();
    expect(parseGoModulePath('go 1.22\nrequire ()')).toBeNull();
  });
});

describe('GoProjectSystem', () => {
  const provider: GoProjectSystem = new GoProjectSystem();

  it('declaresTheGoKindWithAGoosGoarchAxisAndNoBuildConfigs', () => {
    expect(provider.kind).toBe('go');
    expect(provider.capabilities.actions).toEqual(['build', 'clean', 'rebuild']);
    // Go has a target (GOOS/GOARCH) axis but no Debug/Release build-configuration axis.
    expect(provider.capabilities.buildConfigurations).toEqual([]);
    expect(provider.capabilities.target?.kind).toBe('arch');
    // Delve, installed from the Plugin Manager (#1211).
    expect(provider.capabilities.debug).toEqual({ adapter: 'delve' });
  });

  it('ownsGoModManifestsOnly', () => {
    expect(provider.ownsProject('/w/go.mod')).toBe(true);
    expect(provider.ownsProject('/w/go.sum')).toBe(false);
    expect(provider.ownsProject('/w/main.go')).toBe(false);
  });
});

describe.skipIf(process.platform === 'win32')('GoProjectSystem.loadProjectItems (#899)', () => {
  let scratch: string = '';
  let bin: string = '';
  let root: string = '';

  beforeEach(() => {
    scratch = realpathSync(mkdtempSync(path.join(tmpdir(), 'studio-go-')));
    bin = path.join(scratch, 'bin');
    root = path.join(scratch, 'module');
    mkdirSync(bin);
    mkdirSync(root);
    vi.stubEnv('GOROOT', '');
    vi.stubEnv('PATH', `${bin}${path.delimiter}/usr/bin${path.delimiter}/bin`);
    writeFileSync(path.join(root, 'go.mod'), 'module example.com/widget\n');
    writeFileSync(path.join(root, 'go.sum'), '');
    writeFileSync(path.join(root, 'main.go'), 'package main\n');
    writeFileSync(path.join(root, 'build.log'), '');
    mkdirSync(path.join(root, 'output'));
    writeFileSync(path.join(root, 'output', 'widget'), '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(scratch, { recursive: true, force: true });
  });

  /**
   * Puts a fake `go` in place.
   * @param body The shell script's body.
   */
  function go(body: string): void {
    const file: string = path.join(bin, 'go');
    writeFileSync(
      file,
      `#!/bin/sh\n{ pwd; echo "$@"; echo "$GOTOOLCHAIN $GOPROXY"; } > "${file}.log"\n${body}\n`,
    );
    chmodSync(file, 0o755);
  }

  it('listsWhatTheBuildIsMadeOf_leavingOutputsToTheFileExplorer', async () => {
    go(`echo '{"Dir": "${root}", "GoFiles": ["main.go"]}'`);

    const items: ProjectItems | null = await new GoProjectSystem().loadProjectItems(
      path.join(root, 'go.mod'),
    );

    expect(paths(items!.tree)).toEqual(['go.mod', 'go.sum', 'main.go']);
  });

  it('asksFromOutsideTheModule_withNoDownloads', async () => {
    go(`echo '{"Dir": "${root}", "GoFiles": ["main.go"]}'`);

    await new GoProjectSystem().loadProjectItems(path.join(root, 'go.mod'));

    const [cwd, args, env]: string[] = readFileSync(path.join(bin, 'go.log'), 'utf8').split('\n');
    expect(cwd.startsWith(root)).toBe(false);
    expect(args.startsWith(`list -C ${root} -e -find `)).toBe(true);
    expect(env).toBe('local off');
  });

  it('placesFilesUnderTheWorkspacesOwnPath_whenItIsReachedThroughALink', async () => {
    const link: string = path.join(scratch, 'link');
    symlinkSync(root, link);
    go(`echo '{"Dir": "${root}", "GoFiles": ["main.go"]}'`);

    const items: ProjectItems | null = await new GoProjectSystem().loadProjectItems(
      path.join(link, 'go.mod'),
    );

    expect(items!.tree.at(-1)).toMatchObject({ path: path.join(link, 'main.go') });
    expect(readFileSync(path.join(bin, 'go.log'), 'utf8')).toContain(`list -C ${root} `);
  });

  it.each([
    ['the toolchain fails', 'echo nope >&2; exit 1'],
    ['the output is garbage', 'echo \'{"Dir": }\''],
    ['the module has no packages', 'exit 0'],
  ])('fallsBackToTheListing_when %s', async (_name: string, body: string) => {
    go(body);

    const items: ProjectItems | null = await new GoProjectSystem().loadProjectItems(
      path.join(root, 'go.mod'),
    );

    expect(paths(items!.tree)).toEqual([
      'output/',
      'output/widget',
      'build.log',
      'go.mod',
      'go.sum',
      'main.go',
    ]);
  });

  it('fallsBackToTheListing_whenThereIsNoToolchain', async () => {
    // Nothing but the empty folder: a machine can have a real `go` in /usr/bin.
    vi.stubEnv('PATH', bin);

    const items: ProjectItems | null = await new GoProjectSystem().loadProjectItems(
      path.join(root, 'go.mod'),
    );

    expect(paths(items!.tree)).toContain('build.log');
  });

  it('triesTheToolchainUnderGoroot_first', async () => {
    const goroot: string = path.join(scratch, 'goroot');
    mkdirSync(path.join(goroot, 'bin'), { recursive: true });
    vi.stubEnv('GOROOT', goroot);
    const file: string = path.join(goroot, 'bin', 'go');
    writeFileSync(file, `#!/bin/sh\necho '{"Dir": "${root}", "GoFiles": ["main.go"]}'\n`);
    chmodSync(file, 0o755);

    const items: ProjectItems | null = await new GoProjectSystem().loadProjectItems(
      path.join(root, 'go.mod'),
    );

    expect(paths(items!.tree)).toEqual(['go.mod', 'go.sum', 'main.go']);
  });

  it('isNull_whenTheModuleCannotBeRead', async () => {
    expect(
      await new GoProjectSystem().loadProjectItems(path.join(scratch, 'gone', 'go.mod')),
    ).toBeNull();
  });
});
