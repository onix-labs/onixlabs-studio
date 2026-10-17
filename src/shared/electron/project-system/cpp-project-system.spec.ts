import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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
