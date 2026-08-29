import { DirectoryEntry, DirectoryListing } from '@shared/api/workspace-channels';
import { ProjectAction, ProjectEntry } from '@shared/api/project-system';
import {
  BuildFamily,
  commandForAction,
  commandForProjectAction,
  detectBuildFamily,
  supportsProjectAction,
} from './action-commands';

/**
 * The absolute root every fixture is built beneath.
 */
const ROOT: string = '/work/repo';

/**
 * Builds a root listing holding the given file names.
 * @param names The file names present in the root.
 * @returns Returns the listing.
 */
function listing(...names: readonly string[]): DirectoryListing {
  return {
    path: ROOT,
    name: 'repo',
    entries: names.map((name: string): DirectoryEntry => ({
      name,
      path: `${ROOT}/${name}`,
      type: 'file',
    })),
  };
}

/**
 * Builds a project entry for a manifest at a path relative to the root.
 * @param name The project's display name.
 * @param relative The manifest's path relative to the root.
 * @returns Returns the entry.
 */
function project(name: string, relative: string): ProjectEntry {
  return { name, path: `${ROOT}/${relative}` };
}

describe('detectBuildFamily', () => {
  it('detectBuildFamily_returnsNullWhenTheRootBelongsToNoEcosystem', () => {
    expect(detectBuildFamily(listing('README.md'))).toBeNull();
  });

  it('detectBuildFamily_prefersTheCompilingToolchainOverAToolingPackageJson', () => {
    // A .NET repo very often carries a package.json for its front end or its tooling; the toolchain
    // that compiles the sources owns the capability actions.
    expect(detectBuildFamily(listing('App.sln', 'package.json'))).toBe('dotnet');
    expect(detectBuildFamily(listing('Cargo.toml', 'package.json'))).toBe('cargo');
    expect(detectBuildFamily(listing('package.json'))).toBe('node');
  });

  it('detectBuildFamily_prefersGradleOverMavenWhenBothArePresent', () => {
    expect(detectBuildFamily(listing('build.gradle.kts', 'pom.xml'))).toBe('gradle');
  });

  it('detectBuildFamily_recognisesEachEcosystemFromItsManifest', () => {
    expect(detectBuildFamily(listing('Api.csproj'))).toBe('dotnet');
    expect(detectBuildFamily(listing('settings.gradle'))).toBe('gradle');
    expect(detectBuildFamily(listing('pom.xml'))).toBe('maven');
    expect(detectBuildFamily(listing('CMakeLists.txt'))).toBe('cmake');
    expect(detectBuildFamily(listing('Makefile'))).toBe('make');
    expect(detectBuildFamily(listing('go.mod'))).toBe('go');
  });
});

describe('commandForAction', () => {
  it('commandForAction_compilesTheWorkspaceWideCommandForEachFamily', () => {
    expect(commandForAction('build', 'dotnet', listing('App.sln'))).toBe('dotnet build');
    expect(commandForAction('rebuild', 'dotnet', listing('App.sln'))).toBe(
      'dotnet build --no-incremental',
    );
    expect(commandForAction('build', 'cargo', listing('Cargo.toml'))).toBe('cargo build');
    expect(commandForAction('build', 'go', listing('go.mod'))).toBe('go build ./...');
    expect(commandForAction('test', 'node', listing('package.json'))).toBe('npm run test');
  });

  it('commandForAction_prefersACheckedInWrapperOverTheSystemTool', () => {
    expect(commandForAction('build', 'gradle', listing('build.gradle', 'gradlew'))).toBe(
      './gradlew build',
    );
    expect(commandForAction('build', 'gradle', listing('build.gradle'))).toBe('gradle build');
    expect(commandForAction('build', 'maven', listing('pom.xml', 'mvnw'))).toBe('./mvnw package');
    expect(commandForAction('build', 'maven', listing('pom.xml'))).toBe('mvn package');
  });

  it('commandForAction_returnsNullForAnActionTheFamilyDoesNotDeclare', () => {
    expect(commandForAction('publish', 'cargo', listing('Cargo.toml'))).toBeNull();
    expect(commandForAction('rebuild', 'node', listing('package.json'))).toBeNull();
    expect(commandForAction('restore', 'gradle', listing('build.gradle'))).toBeNull();
  });
});

describe('supportsProjectAction', () => {
  it('supportsProjectAction_declaresEveryDotnetVerbNarrowable', () => {
    const actions: readonly ProjectAction[] = [
      'build',
      'clean',
      'rebuild',
      'test',
      'publish',
      'restore',
    ];
    for (const action of actions) {
      expect(supportsProjectAction(action, 'dotnet')).toBe(true);
    }
  });

  it('supportsProjectAction_refusesTheFamiliesWhoseModelHoldsASingleProject', () => {
    // CMake, Make and Go model exactly one project per root, so a per-project verb would compile to
    // the workspace verb — the silent whole-workspace build this feature exists to prevent.
    for (const family of ['cmake', 'make', 'go'] as readonly BuildFamily[]) {
      expect(supportsProjectAction('build', family)).toBe(false);
    }
  });

  it('supportsProjectAction_refusesNodeBecauseAMembersScriptsAreUnknown', () => {
    expect(supportsProjectAction('build', 'node')).toBe(false);
    expect(supportsProjectAction('test', 'node')).toBe(false);
  });

  it('supportsProjectAction_narrowsToTheVerbsEachFamilyDeclares', () => {
    expect(supportsProjectAction('test', 'gradle')).toBe(true);
    expect(supportsProjectAction('publish', 'gradle')).toBe(false);
    expect(supportsProjectAction('rebuild', 'cargo')).toBe(true);
    expect(supportsProjectAction('test', 'cargo')).toBe(false);
  });
});

describe('commandForProjectAction', () => {
  it('commandForProjectAction_namesTheProjectFileForDotnet', () => {
    const entry: ProjectEntry = project('Api', 'src/Api/Api.csproj');
    const root: DirectoryListing = listing('App.sln');

    expect(commandForProjectAction('build', 'dotnet', root, entry)).toBe(
      `dotnet build "${ROOT}/src/Api/Api.csproj"`,
    );
    expect(commandForProjectAction('rebuild', 'dotnet', root, entry)).toBe(
      `dotnet build "${ROOT}/src/Api/Api.csproj" --no-incremental`,
    );
    expect(commandForProjectAction('publish', 'dotnet', root, entry)).toBe(
      `dotnet publish "${ROOT}/src/Api/Api.csproj"`,
    );
  });

  it('commandForProjectAction_namesThePackageForCargo', () => {
    const entry: ProjectEntry = project('engine', 'crates/engine/Cargo.toml');
    const root: DirectoryListing = listing('Cargo.toml');

    expect(commandForProjectAction('build', 'cargo', root, entry)).toBe('cargo build -p engine');
    expect(commandForProjectAction('rebuild', 'cargo', root, entry)).toBe(
      'cargo clean -p engine && cargo build -p engine',
    );
  });

  it('commandForProjectAction_derivesTheGradleProjectPathFromTheModuleDirectory', () => {
    const entry: ProjectEntry = project('core', 'libs/core/build.gradle.kts');
    const root: DirectoryListing = listing('settings.gradle', 'gradlew');

    expect(commandForProjectAction('build', 'gradle', root, entry)).toBe(
      './gradlew :libs:core:build',
    );
    expect(commandForProjectAction('test', 'gradle', root, entry)).toBe(
      './gradlew :libs:core:test',
    );
  });

  it('commandForProjectAction_selectsTheMavenModuleAndMakesItsDependencies', () => {
    const entry: ProjectEntry = project('core', 'core/pom.xml');
    const root: DirectoryListing = listing('pom.xml');

    // Build and test make sibling dependencies as needed; cleaning a module must not clean them.
    expect(commandForProjectAction('build', 'maven', root, entry)).toBe(
      'mvn -pl "core" -am package',
    );
    expect(commandForProjectAction('test', 'maven', root, entry)).toBe('mvn -pl "core" -am test');
    expect(commandForProjectAction('clean', 'maven', root, entry)).toBe('mvn -pl "core" clean');
  });

  it('commandForProjectAction_treatsTheRootProjectAsTheWholeBuild', () => {
    // The root project's manifest sits in the root itself, and it honestly stands for the whole
    // build — so it compiles to the workspace command rather than an unaddressable module path.
    expect(
      commandForProjectAction(
        'build',
        'gradle',
        listing('build.gradle'),
        project('app', 'build.gradle'),
      ),
    ).toBe('gradle build');
    expect(
      commandForProjectAction('build', 'maven', listing('pom.xml'), project('app', 'pom.xml')),
    ).toBe('mvn package');
  });

  it('commandForProjectAction_returnsNullForAProjectOutsideTheRoot', () => {
    const outside: ProjectEntry = { name: 'stray', path: '/elsewhere/stray/pom.xml' };

    expect(commandForProjectAction('build', 'maven', listing('pom.xml'), outside)).toBeNull();
    expect(commandForProjectAction('build', 'gradle', listing('build.gradle'), outside)).toBeNull();
  });

  it('commandForProjectAction_returnsNullWhenTheFamilyHasNoPerProjectForm', () => {
    expect(
      commandForProjectAction('build', 'go', listing('go.mod'), project('app', 'go.mod')),
    ).toBeNull();
    expect(
      commandForProjectAction(
        'build',
        'node',
        listing('package.json'),
        project('web', 'web/package.json'),
      ),
    ).toBeNull();
    expect(
      commandForProjectAction(
        'build',
        'cmake',
        listing('CMakeLists.txt'),
        project('app', 'CMakeLists.txt'),
      ),
    ).toBeNull();
  });
});
