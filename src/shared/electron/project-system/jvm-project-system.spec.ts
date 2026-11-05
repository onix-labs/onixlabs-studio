import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { ProjectItemNode, ProjectItems, ProjectModel } from '@shared/api/project-system';
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

const fixtures: string[] = [];

afterEach(() => {
  for (const root of fixtures.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * Writes a tree of files under a new temporary directory.
 * @param files The files' contents, by relative path.
 * @returns Returns the directory.
 */
function fixture(files: Readonly<Record<string, string>>): string {
  const root: string = realpathSync(mkdtempSync(path.join(tmpdir(), 'studio-project-')));
  fixtures.push(root);
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), content);
  }
  return root;
}

/**
 * Lists the paths of a project tree, folders first.
 * @param nodes The tree.
 * @returns Returns the names, indented by depth.
 */
function names(nodes: readonly ProjectItemNode[], depth: number = 0): string[] {
  return nodes.flatMap((node: ProjectItemNode): string[] => [
    `${' '.repeat(depth)}${node.name}`,
    ...(node.type === 'folder' ? names(node.children, depth + 1) : []),
  ]);
}

describe('JvmProjectSystem on disk', () => {
  const provider: JvmProjectSystem = new JvmProjectSystem();

  it('prefersGradle_whenBothBuildsArePresent', async () => {
    const root: string = fixture({ 'build.gradle': '', 'pom.xml': '<project/>' });

    expect((await provider.load(root))?.projects[0].path).toBe(path.join(root, 'build.gradle'));
  });

  it('detectsASettingsFileAlone', async () => {
    expect(await provider.detect(fixture({ 'settings.gradle.kts': '' }))).toBe(true);
  });

  it('isNull_forAFolderWithNeitherBuild', async () => {
    const root: string = fixture({ 'pom.xml/x': '' });

    expect(await provider.detect(root)).toBe(false);
    expect(await provider.load(root)).toBeNull();
  });

  it('loadsAGradleBuildWithModules_skippingOnesWithNoBuildFile', async () => {
    const root: string = fixture({
      'settings.gradle': "rootProject.name = 'app'\ninclude ':core', ':tools:cli', ':gone'",
      'build.gradle': '',
      'core/build.gradle.kts': '',
      'tools/cli/build.gradle': '',
    });

    const model: ProjectModel | null = await provider.load(root);

    expect(model?.solution?.name).toBe('app');
    expect(model?.projects.map((entry: { name: string }): string => entry.name)).toEqual([
      'app',
      'cli',
      'core',
    ]);
  });

  it('usesTheSettingsFileAsTheManifest_ofARootWithNoBuildFile', async () => {
    const root: string = fixture({ 'settings.gradle': '' });

    const model: ProjectModel | null = await provider.load(root);

    expect(model?.projects[0]).toEqual({
      name: path.basename(root),
      path: path.join(root, 'settings.gradle'),
    });
    expect(model?.solution).toBeNull();
  });

  it('loadsAMavenBuildWithModules_namedByTheirOwnPoms', async () => {
    const root: string = fixture({
      'pom.xml':
        '<project><artifactId>parent</artifactId><modules><module>a</module><module>b</module><module>gone</module></modules></project>',
      'a/pom.xml': '<project><artifactId>alpha</artifactId></project>',
      'b/pom.xml': '<project',
    });

    const model: ProjectModel | null = await provider.load(root);

    expect(model?.projects.map((entry: { name: string }): string => entry.name)).toEqual([
      'parent',
      'alpha',
      'b',
    ]);
  });

  it('survivesAPomThatIsNotXml', async () => {
    const root: string = fixture({ 'pom.xml': '\u0000 not xml <<<' });

    expect((await provider.load(root))?.projects[0].name).toBe(path.basename(root));
  });

  it('listsAProjectsItems_leavingNestedModulesToTheirOwnNodes', async () => {
    const root: string = fixture({
      'pom.xml': '',
      'src/Main.java': '',
      'src/inner/pom.xml': '',
      'target/classes/Main.class': '',
    });

    const items: ProjectItems | null = await provider.loadProjectItems(path.join(root, 'pom.xml'));

    expect(names(items?.tree ?? [])).toEqual(['src', ' Main.java', 'pom.xml']);
  });

  it('isNull_forItemsOfAProjectWhoseFolderHasGone', async () => {
    expect(await provider.loadProjectItems('/no/such/place/pom.xml')).toBeNull();
  });
});
