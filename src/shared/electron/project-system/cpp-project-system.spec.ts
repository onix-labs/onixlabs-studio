import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { BuildConfiguration, ProjectItemNode, ProjectItems } from '@shared/api/project-system';
import { buildTargetTree, CppProjectSystem, parseCmakeProjectName } from './cpp-project-system';

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

describe('buildTargetTree (#882 follow-up)', () => {
  it('groupsEachTargetsSources_thenTheProjectsCMakeLists', () => {
    const tree: readonly ProjectItemNode[] = buildTargetTree('/p/CMakeLists.txt', [
      { name: 'app', type: 'EXECUTABLE', sources: ['src/main.c', 'src/util.c'] },
      { name: 'core', type: 'SHARED_LIBRARY', sources: ['/p/lib/core.c'] },
      { name: 'docs', type: 'UTILITY', sources: [] },
    ]);

    expect(paths(tree)).toEqual([
      'app (executable)/',
      'app (executable)/src/',
      'app (executable)/src/main.c',
      'app (executable)/src/util.c',
      'core (shared library)/',
      'core (shared library)/lib/',
      'core (shared library)/lib/core.c',
      'CMakeLists.txt',
    ]);
    // A target is a grouping of the build, not a directory.
    expect(tree[0].type === 'folder' && tree[0].path).toBeNull();
  });
});

describe('CppProjectSystem.loadProjectItems without a build model (#882 follow-up)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(realpathSync(tmpdir()), 'cpp-items-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('listsOnlyWhatTheBuildIsMadeOf_soOutputsCannotCrowdOutTheSources', async () => {
    writeFileSync(path.join(root, 'Makefile'), 'all:\n');
    writeFileSync(path.join(root, 'disk.iso'), '');
    mkdirSync(path.join(root, 'runs'));
    // More outputs than the listing's whole budget, in a folder that sorts before src.
    for (let index: number = 0; index < 5_100; index += 1) {
      writeFileSync(path.join(root, 'runs', `run-${index}.log`), '');
    }
    mkdirSync(path.join(root, 'src'));
    writeFileSync(path.join(root, 'src', 'main.c'), '');
    writeFileSync(path.join(root, 'src', 'main.h'), '');

    const items: ProjectItems | null = await new CppProjectSystem().loadProjectItems(
      path.join(root, 'Makefile'),
    );

    expect(paths(items!.tree)).toEqual(['src/', 'src/main.c', 'src/main.h', 'Makefile']);
  });

  it('listsTheSources_forACMakeProjectWithNoConfiguredBuildTree', async () => {
    writeFileSync(path.join(root, 'CMakeLists.txt'), 'project(demo)\n');
    mkdirSync(path.join(root, 'src'));
    writeFileSync(path.join(root, 'src', 'main.cpp'), '');

    const items: ProjectItems | null = await new CppProjectSystem().loadProjectItems(
      path.join(root, 'CMakeLists.txt'),
    );

    expect(paths(items!.tree)).toEqual(['src/', 'src/main.cpp', 'CMakeLists.txt']);
  });
});

describe('CppProjectSystem.loadProjectItems with a configured build tree (#1213)', () => {
  let root: string;
  let build: string;
  let invoked: string;

  /**
   * Writes a build tree configured by a stand-in `cmake`, which records its arguments.
   * @param cacheEntry A line to add to the cache.
   */
  function configured(cacheEntry: string): void {
    const cmake: string = path.join(root, 'fake-cmake');
    writeFileSync(cmake, `#!/bin/sh\necho "$@" >> "${invoked}"\n`);
    chmodSync(cmake, 0o755);
    writeFileSync(
      path.join(build, 'CMakeCache.txt'),
      `CMAKE_COMMAND:INTERNAL=${cmake}\n${cacheEntry}\n`,
    );
  }

  /**
   * Writes the File API reply a configure would have left: one target.
   */
  function answered(): void {
    const reply: string = path.join(build, '.cmake', 'api', 'v1', 'reply');
    mkdirSync(reply, { recursive: true });
    const write: (name: string, value: unknown) => void = (name: string, value: unknown): void =>
      writeFileSync(path.join(reply, name), JSON.stringify(value));
    write('index-2026-11-07T00-00-00-0000.json', {
      objects: [{ kind: 'codemodel', version: { major: 2 }, jsonFile: 'codemodel.json' }],
    });
    write('codemodel.json', { configurations: [{ targets: [{ jsonFile: 'target-app.json' }] }] });
    write('target-app.json', { name: 'app', type: 'EXECUTABLE', sources: [{ path: 'main.cpp' }] });
  }

  /**
   * Loads the project's contents and reads what `cmake` was asked.
   * @returns Returns the recorded command lines, and the contents.
   */
  async function load(): Promise<{ calls: readonly string[]; tree: readonly string[] }> {
    const items: ProjectItems | null = await new CppProjectSystem().loadProjectItems(
      path.join(root, 'CMakeLists.txt'),
    );
    const calls: readonly string[] = existsSync(invoked)
      ? readFileSync(invoked, 'utf8').trim().split('\n')
      : [];
    return { calls, tree: paths(items!.tree) };
  }

  beforeEach(() => {
    root = mkdtempSync(path.join(realpathSync(tmpdir()), 'cpp-configured-'));
    build = path.join(root, 'build');
    invoked = path.join(root, 'invoked');
    mkdirSync(build);
    writeFileSync(path.join(root, 'CMakeLists.txt'), 'project(demo)\n');
    writeFileSync(path.join(root, 'main.cpp'), '');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reconfiguresOnce_soATreeWithNoDatabaseWritesOne', async () => {
    configured('CMAKE_EXPORT_COMPILE_COMMANDS:BOOL=');
    answered();

    const { calls, tree } = await load();

    expect(calls).toEqual([`-S ${root} -B ${build} -DCMAKE_EXPORT_COMPILE_COMMANDS=ON`]);
    expect(tree).toContain('app (executable)/main.cpp');
  });

  it('leavesATreeAlone_thatAlreadyWritesTheDatabase', async () => {
    configured('CMAKE_EXPORT_COMPILE_COMMANDS:BOOL=');
    answered();
    writeFileSync(path.join(build, 'compile_commands.json'), '[]');

    expect((await load()).calls).toEqual([]);
  });

  it('leavesATreeAlone_whoseOwnerTurnedTheDatabaseOff', async () => {
    configured('CMAKE_EXPORT_COMPILE_COMMANDS:BOOL=OFF');
    answered();

    expect((await load()).calls).toEqual([]);
  });

  it('stillListsTheTargets_whenTheReconfigureFails', async () => {
    configured('CMAKE_EXPORT_COMPILE_COMMANDS:BOOL=');
    answered();
    writeFileSync(path.join(root, 'fake-cmake'), '#!/bin/sh\nexit 1\n');

    expect((await load()).tree).toContain('app (executable)/main.cpp');
  });
});

describe('parseCmakeProjectName', () => {
  it('readsTheProjectCommandName', () => {
    expect(parseCmakeProjectName('project(MyApp VERSION 1.0 LANGUAGES CXX)')).toBe('MyApp');
    expect(parseCmakeProjectName('project ( my_app )')).toBe('my_app');
  });

  it('returnsNullWhenAbsent', () => {
    expect(parseCmakeProjectName(null)).toBeNull();
    expect(parseCmakeProjectName('add_executable(app main.cpp)')).toBeNull();
  });
});

describe('CppProjectSystem', () => {
  const provider: CppProjectSystem = new CppProjectSystem();

  it('declaresTheCppKindWithBuildConfigsAndATargetAxis', () => {
    expect(provider.kind).toBe('cpp');
    expect(provider.capabilities.actions).toEqual(['build', 'clean', 'rebuild']);
    // Unlike the interpreted Python case, C/C++ keeps a build-configuration axis and a target axis.
    expect(
      provider.capabilities.buildConfigurations.map((c: BuildConfiguration): string => c.id),
    ).toEqual(['debug', 'release', 'relwithdebinfo', 'minsizerel']);
    expect(provider.capabilities.target?.kind).toBe('arch');
    // No C/C++ DAP adapter provisioned yet.
    expect(provider.capabilities.debug).toBeNull();
  });

  it('ownsCmakeAndMakefileManifestsOnly', () => {
    expect(provider.ownsProject('/w/CMakeLists.txt')).toBe(true);
    expect(provider.ownsProject('/w/Makefile')).toBe(true);
    expect(provider.ownsProject('/w/GNUmakefile')).toBe(true);
    expect(provider.ownsProject('/w/makefile')).toBe(true);
    expect(provider.ownsProject('/w/main.cpp')).toBe(false);
    expect(provider.ownsProject('/w/package.json')).toBe(false);
  });
});
