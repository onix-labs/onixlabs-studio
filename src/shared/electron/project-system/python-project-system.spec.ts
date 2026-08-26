import { DebugResolveResult } from '@shared/api/debug-channels';
import { RunConfiguration } from '@shared/api/studio';
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
