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

  it('declaresThePythonKindAndNoGatedControls', () => {
    expect(provider.kind).toBe('python');
    // The whole point of the interpreted case: no build/clean actions, no build-config or target axis,
    // and no debug adapter yet — so the ribbon's gated controls disappear entirely.
    expect(provider.capabilities.actions).toEqual([]);
    expect(provider.capabilities.buildConfigurations).toEqual([]);
    expect(provider.capabilities.target).toBeNull();
    expect(provider.capabilities.debug).toBeNull();
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
});
