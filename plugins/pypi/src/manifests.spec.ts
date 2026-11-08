import { describe, expect, it } from 'vitest';
import {
  DeclaredPackage,
  Pyproject,
  readPipfile,
  readPyproject,
  readSetupCfg,
  readSetupPy,
  scopeOf,
} from './manifests';

/**
 * Reduces packages to what a spec compares: name, requested, and the scope its placement maps to.
 * @param packages The packages.
 * @returns Returns the summary.
 */
function summary(packages: readonly DeclaredPackage[] | null | undefined): readonly string[] {
  return (packages ?? []).map(
    (declared: DeclaredPackage): string =>
      `${declared.name} ${declared.requested} ${scopeOf(declared.placement)}${declared.fromIndex ? '' : ' (not from an index)'}`,
  );
}

describe('readPyproject', () => {
  it('readPyproject_pep621AndPep735_mapsDependenciesExtrasAndGroups', () => {
    // Arrange
    const text: string = [
      '[project]',
      'name = "demo"',
      'dependencies = ["requests>=2.31", "tomli; python_version < \'3.11\'"]',
      '[project.optional-dependencies]',
      'socks = ["PySocks>=1.7"]',
      '[dependency-groups]',
      'test = ["pytest>=8", { include-group = "lint" }]',
      'lint = ["ruff"]',
      '[tool.uv]',
      'dev-dependencies = ["mypy"]',
    ].join('\n');

    // Act
    const pyproject: Pyproject | null = readPyproject(text);

    // Assert
    expect(pyproject?.name).toBe('demo');
    expect(pyproject?.usesUv).toBe(true);
    expect(pyproject?.usesPoetry).toBe(false);
    expect(summary(pyproject?.packages)).toEqual([
      'requests >=2.31 production',
      'tomli * production',
      'PySocks >=1.7 optional',
      'pytest >=8 development',
      'ruff * development',
      'mypy * development',
    ]);
    expect(pyproject?.packages[2].placement).toEqual({ kind: 'optional', extra: 'socks' });
    expect(pyproject?.packages[3].placement).toEqual({ kind: 'group', group: 'test' });
  });

  it('readPyproject_poetryTables_mapsMainOptionalGroupsAndNonIndexSources', () => {
    // Arrange
    const text: string = [
      '[tool.poetry]',
      'name = "poetry-demo"',
      '[tool.poetry.dependencies]',
      'python = "^3.11"',
      'requests = "^2.31"',
      'rich = { version = "^13", optional = true }',
      'local = { path = "../local", develop = true }',
      'numpy = [{ version = "<2", python = "<3.9" }, { version = ">=2", python = ">=3.9" }]',
      '[tool.poetry.dev-dependencies]',
      'black = "*"',
      '[tool.poetry.group.test.dependencies]',
      'pytest = "^8"',
    ].join('\n');

    // Act
    const pyproject: Pyproject | null = readPyproject(text);

    // Assert
    expect(pyproject?.name).toBe('poetry-demo');
    expect(pyproject?.usesPoetry).toBe(true);
    expect(summary(pyproject?.packages)).toEqual([
      'requests ^2.31 production',
      'rich ^13 optional',
      'local direct reference production (not from an index)',
      'numpy <2 || >=2 production',
      'black * development',
      'pytest ^8 development',
    ]);
    expect(pyproject?.packages.at(-1)?.placement).toEqual({ kind: 'group', group: 'test' });
  });

  it('readPyproject_aPackageUnderTwoMarkers_isListedOnce', () => {
    // Arrange
    const text: string =
      '[project]\ndependencies = ["numpy<2; python_version<\'3.9\'", "NumPy>=2; python_version>=\'3.9\'"]';

    // Act
    const pyproject: Pyproject | null = readPyproject(text);

    // Assert
    expect(summary(pyproject?.packages)).toEqual(['numpy <2 production']);
  });

  it('readPyproject_notToml_answersNull', () => {
    // Act
    const pyproject: Pyproject | null = readPyproject('[project\nname = ');

    // Assert
    expect(pyproject).toBeNull();
  });
});

describe('readPipfile', () => {
  it('readPipfile_packagesAndDevPackages_mapToProductionAndDevelopment', () => {
    // Arrange
    const text: string = [
      '[[source]]',
      'url = "https://pypi.org/simple"',
      '[packages]',
      'requests = "*"',
      'django = { version = "==5.0" }',
      'mine = { git = "https://github.com/me/mine.git" }',
      '[dev-packages]',
      'pytest = ">=8"',
      '[requires]',
      'python_version = "3.12"',
    ].join('\n');

    // Act
    const packages: readonly DeclaredPackage[] | null = readPipfile(text);

    // Assert
    expect(summary(packages)).toEqual([
      'requests * production',
      'django ==5.0 production',
      'mine direct reference production (not from an index)',
      'pytest >=8 development',
    ]);
  });
});

describe('readSetupCfg', () => {
  it('readSetupCfg_installRequiresAndExtras_mapToProductionAndOptional', () => {
    // Arrange
    const text: string = [
      '[metadata]',
      'name = demo',
      '[options]',
      'install_requires =',
      '    requests>=2.31',
      '    # a comment line',
      '    click',
      '[options.extras_require]',
      'yaml =',
      '    PyYAML>=6',
    ].join('\n');

    // Act
    const packages: readonly DeclaredPackage[] = readSetupCfg(text);

    // Assert
    expect(summary(packages)).toEqual([
      'requests >=2.31 production',
      'click * production',
      'PyYAML >=6 optional',
    ]);
    expect(packages[2].placement).toEqual({ kind: 'optional', extra: 'yaml' });
  });
});

describe('readSetupPy', () => {
  it('readSetupPy_aLiteralList_isRead', () => {
    // Arrange
    const text: string = [
      'from setuptools import setup',
      'setup(',
      '    name="demo",',
      '    install_requires=[',
      '        "requests>=2.31",  # comment',
      "        'click',",
      '    ],',
      ')',
    ].join('\n');

    // Act
    const packages: readonly DeclaredPackage[] = readSetupPy(text);

    // Assert
    expect(summary(packages)).toEqual(['requests >=2.31 production', 'click * production']);
  });

  it.each<[string, string]>([
    ['aVariable', 'setup(install_requires=["a", base])'],
    ['aConcatenation', 'setup(install_requires=["requests"] + EXTRA)'],
    ['anEscapedString', 'setup(install_requires=["a\\"b"])'],
  ])('readSetupPy_%s_isNotReadAtAll', (_name: string, text: string) => {
    // Act
    const packages: readonly DeclaredPackage[] = readSetupPy(text);

    // Assert
    expect(packages).toEqual([]);
  });

  it('readSetupPy_extrasInARequirement_doNotEndTheList', () => {
    // Act
    const packages: readonly DeclaredPackage[] = readSetupPy(
      'setup(install_requires=["requests[socks]>=2", "rich"])',
    );

    // Assert
    expect(summary(packages)).toEqual(['requests >=2 production', 'rich * production']);
  });

  it('readSetupPy_noInstallRequires_declaresNothing', () => {
    // Act
    const packages: readonly DeclaredPackage[] = readSetupPy('setup(name="demo")');

    // Assert
    expect(packages).toEqual([]);
  });
});
