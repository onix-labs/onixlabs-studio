import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { DebugResolveResult } from '@shared/api/debug-channels';
import { ProjectItemNode, ProjectItems } from '@shared/api/project-system';
import { RunConfiguration } from '@shared/api/studio';
import { declaredPackagePaths, declaresBuildSystem } from './pyproject-layout';
import {
  parsePyprojectName,
  parseSetupCfgName,
  parseSetupPyName,
  PythonProjectSystem,
} from './python-project-system';

describe('parsePyprojectName', () => {
  it('readsThePep621ProjectName', () => {
    const toml: string = ['[project]', 'name = "my-app"', 'version = "1.0"'].join('\n');
    expect(parsePyprojectName(toml)).toBe('my-app');
  });

  it('readsThePoetryName', () => {
    const toml: string = ['[tool.poetry]', "name = 'poetry-app'"].join('\n');
    expect(parsePyprojectName(toml)).toBe('poetry-app');
  });

  it('doesNotReadANameFromAnotherTable', () => {
    // The name belongs to [tool.black], not [project]; it must not be mistaken for the project name.
    const toml: string = ['[project]', 'version = "1.0"', '', '[tool.black]', 'name = "x"'].join(
      '\n',
    );
    expect(parsePyprojectName(toml)).toBeNull();
  });

  it('returnsNullWhenAbsent', () => {
    expect(parsePyprojectName(null)).toBeNull();
    expect(parsePyprojectName('[build-system]\nrequires = []')).toBeNull();
  });
});

describe('parseSetupPyName', () => {
  it('readsTheSetupKeywordArgument', () => {
    expect(parseSetupPyName('setup(\n  name="legacy-app",\n  version="0.1",\n)')).toBe(
      'legacy-app',
    );
  });

  it('returnsNullWhenAbsent', () => {
    expect(parseSetupPyName(null)).toBeNull();
    expect(parseSetupPyName('setup(version="0.1")')).toBeNull();
  });
});

describe('parseSetupCfgName', () => {
  it('readsTheMetadataName', () => {
    const cfg: string = ['[metadata]', 'name = cfg-app', 'version = 0.1'].join('\n');
    expect(parseSetupCfgName(cfg)).toBe('cfg-app');
  });

  it('returnsNullWhenTheMetadataSectionHasNoName', () => {
    expect(parseSetupCfgName('[options]\nname = not-metadata')).toBeNull();
    expect(parseSetupCfgName(null)).toBeNull();
  });
});

describe('PythonProjectSystem', () => {
  const provider: PythonProjectSystem = new PythonProjectSystem();

  it('declaresThePythonKindAndNoGatedBuildControls', () => {
    expect(provider.kind).toBe('python');
    // The whole point of the interpreted case: no build/clean actions, and no build-config or target
    // axis — so the ribbon's Solution group disappears entirely.
    expect(provider.capabilities.actions).toEqual([]);
    expect(provider.capabilities.buildConfigurations).toEqual([]);
    expect(provider.capabilities.target).toBeNull();
  });

  it('declaresDebugpyAsItsDebugger', () => {
    // The capability says what the ecosystem supports; whether debugpy is *installed* is the Plugin
    // Manager's business, and the renderer resolves the declared adapter against what is installed.
    expect(provider.capabilities.debug).toEqual({ adapter: 'debugpy' });
  });

  it('ownsPythonManifestsOnly', () => {
    expect(provider.ownsProject('/w/pyproject.toml')).toBe(true);
    expect(provider.ownsProject('/w/setup.py')).toBe(true);
    expect(provider.ownsProject('/w/setup.cfg')).toBe(true);
    expect(provider.ownsProject('/w/requirements.txt')).toBe(true);
    expect(provider.ownsProject('/w/Pipfile')).toBe(true);
    expect(provider.ownsProject('/w/package.json')).toBe(false);
    expect(provider.ownsProject('/w/app.csproj')).toBe(false);
  });

  describe('resolveDebugTarget', () => {
    it('refusesAProgramOutsideTheWorkspace', async () => {
      // The program comes from renderer-supplied configuration, so a hostile one must not point the
      // debugger at a file the user never opened.
      const result: DebugResolveResult = await provider.resolveDebugTarget(
        { name: 'run', providerKind: 'python', program: '../../../etc/passwd' } as RunConfiguration,
        '/w/project',
      );

      expect(result.target).toBeNull();
      expect(result.error).toContain('inside the workspace');
    });

    it('reportsWhenNoEntryPointCanBeFound', async () => {
      const result: DebugResolveResult = await provider.resolveDebugTarget(
        { name: 'run', providerKind: 'python' } as RunConfiguration,
        '/w/empty-project-that-does-not-exist',
      );

      expect(result.target).toBeNull();
      expect(result.error).toContain('entry point');
    });
  });
});

describe('declaredPackagePaths (#899)', () => {
  it('readsSetuptoolsPackages_reducedToTheirTopLevelFolders_underTheirRoot', () => {
    const toml: string = [
      '[tool.setuptools]',
      'packages = ["acme", "acme.sub", "tools"]',
      'py-modules = ["single"]',
      'package-dir = {"" = "lib"}',
    ].join('\n');

    expect(declaredPackagePaths(toml)).toEqual(['lib/acme', 'lib/tools', 'lib/single.py']);
  });

  it('readsAPackageDirTable', () => {
    const toml: string = [
      '[tool.setuptools]',
      'packages = ["acme"]',
      '[tool.setuptools.package-dir]',
      '"" = "lib"',
    ].join('\n');

    expect(declaredPackagePaths(toml)).toEqual(['lib/acme']);
  });

  it('readsSetuptoolsFindRoots', () => {
    expect(
      declaredPackagePaths('[tool.setuptools.packages.find]\nwhere = ["src", "extra"]\n'),
    ).toEqual(['src', 'extra']);
  });

  it('readsSetuptoolsFindPatterns_atTheRoot', () => {
    const toml: string = [
      '[tool.setuptools.packages.find]',
      'where = ["."]',
      'include = ["acme*", "tools.*", "odd?name"]',
    ].join('\n');

    expect(declaredPackagePaths(toml)).toEqual(['acme', 'tools']);
  });

  it('readsNothing_fromASearchOfTheRootWithNoPatterns', () => {
    expect(declaredPackagePaths('[tool.setuptools.packages.find]\nexclude = ["x"]\n')).toEqual([]);
  });

  it('readsPoetryPackages_skippingGlobs', () => {
    const toml: string = [
      '[tool.poetry]',
      'name = "x"',
      'packages = [',
      '  { include = "acme", from = "src" },',
      '  { include = "plain" },',
      '  { include = "glob*" },',
      ']',
    ].join('\n');

    expect(declaredPackagePaths(toml)).toEqual(['src/acme', 'plain']);
  });

  it('readsHatchFlitUvPdmAndMaturin', () => {
    expect(
      declaredPackagePaths('[tool.hatch.build.targets.wheel]\npackages = ["src/acme"]\n'),
    ).toEqual(['src/acme']);
    expect(declaredPackagePaths('[tool.flit.module]\nname = "acme"\n')).toEqual([
      'acme',
      'acme.py',
      'src/acme',
      'src/acme.py',
    ]);
    expect(declaredPackagePaths('[tool.uv.build-backend]\nmodule-name = "acme.core"\n')).toEqual([
      'src/acme/core',
    ]);
    expect(
      declaredPackagePaths('[tool.uv.build-backend]\nmodule-root = ""\nmodule-name = "acme"\n'),
    ).toEqual(['acme']);
    expect(declaredPackagePaths('[tool.pdm.build]\npackage-dir = "lib"\n')).toEqual(['lib']);
    expect(declaredPackagePaths('[tool.maturin]\npython-source = "python"\n')).toEqual(['python']);
  });

  it('isNotFooledByComments_orAKeyInAnotherTable', () => {
    const toml: string = [
      '# packages = ["commented"]',
      '[tool.setuptools]',
      'packages = [',
      '  "real", # "alsoCommented"',
      ']',
      '[tool.other]',
      'python-source = "nope"',
    ].join('\n');

    expect(declaredPackagePaths(toml)).toEqual(['real']);
  });

  it('declaresNothing_forAProjectThatOnlyNamesItself', () => {
    expect(declaredPackagePaths('[project]\nname = "acme"\n')).toEqual([]);
  });
});

describe('declaresBuildSystem (#899)', () => {
  it('readsTheTable', () => {
    expect(declaresBuildSystem('[build-system]\nrequires = []\n')).toBe(true);
    expect(declaresBuildSystem('# [build-system]\n[tool.ruff]\n')).toBe(false);
  });
});

describe('PythonProjectSystem.loadProjectItems (#899)', () => {
  let root: string = '';

  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), 'studio-python-')));
    write({
      'acme/__init__.py': '',
      'acme/data/table.csv': '',
      'acme/__pycache__/x.pyc': '',
      'tests/test_acme.py': '',
      'main.py': '',
      'requirements-dev.txt': '',
      'uv.lock': '',
      'notes.txt': '',
      'output/run.log': '',
      'build/lib/acme.py': '',
      '.venv/lib/x.py': '',
    });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /**
   * Writes files under the fixture.
   * @param files The files' contents, by relative path.
   */
  function write(files: Readonly<Record<string, string>>): void {
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
      writeFileSync(path.join(root, name), content);
    }
  }

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

  /**
   * Loads the fixture's contents, listed by {@link flat}.
   * @returns Returns the paths.
   */
  async function load(): Promise<string[]> {
    const items: ProjectItems | null = await new PythonProjectSystem().loadProjectItems(
      path.join(root, 'pyproject.toml'),
    );
    return flat(items!.tree);
  }

  it('listsTheDeclaredPackage_itsTestsAndRootFiles_leavingTheRestToTheFileExplorer', async () => {
    write({ 'pyproject.toml': '[tool.setuptools]\npackages = ["acme"]\n' });

    expect(await load()).toEqual([
      'acme/',
      'acme/data/',
      'acme/data/table.csv',
      'acme/__init__.py',
      'tests/',
      'tests/test_acme.py',
      'main.py',
      'pyproject.toml',
      'requirements-dev.txt',
      'uv.lock',
    ]);
  });

  it('treatsSrcAsTheSources_forABuiltProjectDeclaringNoPackages', async () => {
    write({
      'pyproject.toml': '[build-system]\nrequires = ["setuptools"]\n',
      'src/acme/__init__.py': '',
    });

    const listed: string[] = await load();

    expect(listed).toContain('src/acme/__init__.py');
    expect(listed).not.toContain('acme/__init__.py');
  });

  it('listsADeclaredModuleFile', async () => {
    write({ 'pyproject.toml': '[tool.flit.module]\nname = "single"\n', 'single.py': '' });

    expect(await load()).toContain('single.py');
    expect(await load()).not.toContain('notes.txt');
  });

  it.each([
    ['declares nothing', '[project]\nname = "acme"\n'],
    ['is only tool configuration', '[tool.ruff]\nline-length = 100\n'],
    ['declares what is not there', '[tool.setuptools]\npackages = ["gone"]\n'],
    ['declares its own root', '[tool.hatch.build.targets.wheel]\npackages = ["."]\n'],
    ['builds with no src folder', '[build-system]\nrequires = []\n'],
  ])('fallsBackToTheListing_whenTheProject %s', async (_name: string, toml: string) => {
    write({ 'pyproject.toml': toml });

    expect(await load()).toEqual(expect.arrayContaining(['notes.txt', 'output/run.log']));
  });

  it('refusesADeclaredPathOutsideTheProject', async () => {
    const outside: string = realpathSync(mkdtempSync(path.join(tmpdir(), 'studio-outside-')));
    writeFileSync(path.join(outside, 'secret.py'), '');
    write({
      'pyproject.toml': `[tool.hatch.build.targets.wheel]\npackages = ["../${path.basename(outside)}", "${outside}", "acme"]\n`,
    });

    const listed: string[] = await load();
    rmSync(outside, { recursive: true, force: true });

    expect(listed.some((entry: string): boolean => entry.includes('secret.py'))).toBe(false);
    expect(listed).toContain('acme/__init__.py');
  });

  it('doesNotFollowADeclaredLinkOutOfTheProject', async () => {
    const outside: string = realpathSync(mkdtempSync(path.join(tmpdir(), 'studio-outside-')));
    writeFileSync(path.join(outside, 'secret.py'), '');
    symlinkSync(outside, path.join(root, 'linked'));
    write({ 'pyproject.toml': '[tool.setuptools]\npackages = ["linked", "acme"]\n' });

    const listed: string[] = await load();
    rmSync(outside, { recursive: true, force: true });

    expect(listed.some((entry: string): boolean => entry.includes('secret.py'))).toBe(false);
  });

  it('fallsBackToTheListing_forAProjectWithNoPyproject', async () => {
    write({ 'requirements.txt': '' });

    const items: ProjectItems | null = await new PythonProjectSystem().loadProjectItems(
      path.join(root, 'requirements.txt'),
    );

    expect(flat(items!.tree)).toContain('notes.txt');
  });

  it('isNull_whenTheProjectCannotBeRead', async () => {
    expect(
      await new PythonProjectSystem().loadProjectItems(path.join(root, 'gone', 'pyproject.toml')),
    ).toBeNull();
  });
});
