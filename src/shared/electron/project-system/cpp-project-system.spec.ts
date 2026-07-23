import { BuildConfiguration } from '@shared/api/project-system';
import { CppProjectSystem, parseCmakeProjectName } from './cpp-project-system';

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
