import {
  JvmProjectSystem,
  parseGradleModules,
  parseGradleRootName,
  parseMavenModules,
  parseMavenName,
} from './jvm-project-system';

describe('parseGradleRootName', () => {
  it('readsTheDeclaredName', () => {
    expect(parseGradleRootName("rootProject.name = 'my-app'")).toBe('my-app');
    expect(parseGradleRootName('rootProject.name = "my-app"')).toBe('my-app');
  });

  it('returnsNullWhenAbsentOrEmpty', () => {
    expect(parseGradleRootName(null)).toBeNull();
    expect(parseGradleRootName('include ":core"')).toBeNull();
  });
});

describe('parseGradleModules', () => {
  it('readsIncludedModulesFromBothDsls', () => {
    const settings: string = ["include 'core', 'app'", 'include(":lib")'].join('\n');
    expect(parseGradleModules(settings)).toEqual(['core', 'app', 'lib']);
  });

  it('dropsLeadingColonsAndNestsColonPaths', () => {
    expect(parseGradleModules('include ":core:api"')).toEqual(['core/api']);
  });

  it('returnsEmptyWhenAbsentOrNoIncludes', () => {
    expect(parseGradleModules(null)).toEqual([]);
    expect(parseGradleModules("rootProject.name = 'x'")).toEqual([]);
  });
});

describe('parseMavenName', () => {
  it('prefersTheNameElement', () => {
    expect(
      parseMavenName('<project><name>My App</name><artifactId>app</artifactId></project>'),
    ).toBe('My App');
  });

  it('fallsBackToTheProjectArtifactIdNotTheParent', () => {
    const pom: string = [
      '<project>',
      '  <parent><artifactId>parent-app</artifactId></parent>',
      '  <artifactId>child-app</artifactId>',
      '</project>',
    ].join('\n');
    expect(parseMavenName(pom)).toBe('child-app');
  });

  it('returnsNullWhenAbsent', () => {
    expect(parseMavenName(null)).toBeNull();
    expect(parseMavenName('<project></project>')).toBeNull();
  });
});

describe('parseMavenModules', () => {
  it('readsTheModulesBlock', () => {
    const pom: string = [
      '<project><modules>',
      '  <module>core</module>',
      '  <module>web</module>',
      '</modules></project>',
    ].join('\n');
    expect(parseMavenModules(pom)).toEqual(['core', 'web']);
  });

  it('returnsEmptyWhenAbsent', () => {
    expect(parseMavenModules(null)).toEqual([]);
    expect(parseMavenModules('<project></project>')).toEqual([]);
  });
});

describe('JvmProjectSystem', () => {
  const provider: JvmProjectSystem = new JvmProjectSystem();

  it('declaresTheJvmKindAndBuildCleanTestCapabilities', () => {
    expect(provider.kind).toBe('jvm');
    expect(provider.capabilities.actions).toEqual(['build', 'clean', 'test']);
    // No fixed build-configuration or target axis, and no debug adapter provisioned yet.
    expect(provider.capabilities.buildConfigurations).toEqual([]);
    expect(provider.capabilities.target).toBeNull();
    expect(provider.capabilities.debug).toBeNull();
  });

  it('ownsGradleAndMavenManifestsOnly', () => {
    expect(provider.ownsProject('/w/build.gradle')).toBe(true);
    expect(provider.ownsProject('/w/build.gradle.kts')).toBe(true);
    expect(provider.ownsProject('/w/pom.xml')).toBe(true);
    expect(provider.ownsProject('/w/app.csproj')).toBe(false);
    expect(provider.ownsProject('/w/package.json')).toBe(false);
  });
});
