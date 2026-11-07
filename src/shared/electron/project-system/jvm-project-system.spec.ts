import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
import { gradleSourceDirectories, mavenSourceDirectories } from './jvm-source-sets';

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

describe('mavenSourceDirectories (#899)', () => {
  it('readsTheSourceFolders_andEachResourceDirectory', () => {
    const pom: string = [
      '<project><build>',
      '<sourceDirectory>java</sourceDirectory>',
      '<testSourceDirectory>${project.basedir}/checks</testSourceDirectory>',
      '<resources><resource><directory>assets</directory></resource></resources>',
      '<testResources><testResource><directory>fixtures</directory></testResource></testResources>',
      '</build></project>',
    ].join('\n');

    expect(mavenSourceDirectories(pom)).toEqual(['java', 'checks', 'assets', 'fixtures']);
  });

  it('leavesOutComments_andPathsBuiltFromOtherProperties', () => {
    const pom: string = [
      '<!-- <sourceDirectory>old</sourceDirectory> -->',
      '<sourceDirectory>${gen.dir}/java</sourceDirectory>',
      '<outputDirectory>target/x</outputDirectory>',
    ].join('\n');

    expect(mavenSourceDirectories(pom)).toEqual([]);
    expect(mavenSourceDirectories(null)).toEqual([]);
  });

  it('readsAroundEveryComment_andStopsAtAnUnclosedOne', () => {
    const pom: string = [
      '<sourceDirectory>a</sourceDirectory>',
      '<!-- one --><sourceDirectory>b</sourceDirectory><!-- two -->',
      '<!-- never closed <sourceDirectory>c</sourceDirectory>',
    ].join('\n');

    expect(mavenSourceDirectories(pom)).toEqual(['a', 'b']);
  });
});

describe('gradleSourceDirectories (#899)', () => {
  it('readsEveryForm_inBothDsls', () => {
    const script: string = [
      "main { java { srcDirs = ['app', 'lib'] } }",
      'kotlin.srcDir("kt")',
      "test.java.srcDir 'checks'",
      'resources.setSrcDirs(listOf("assets"))',
    ].join('\n');

    expect(gradleSourceDirectories(script)).toEqual(['app', 'lib', 'kt', 'checks', 'assets']);
  });

  it('leavesOutComments_andPathsBuiltFromVariables', () => {
    const script: string = [
      "// srcDir 'old'",
      "/* srcDir 'older' */",
      'srcDir("$buildDir/generated")',
      'srcDir(generatedRoot)',
    ].join('\n');

    expect(gradleSourceDirectories(script)).toEqual([]);
    expect(gradleSourceDirectories(null)).toEqual([]);
  });
});

describe('JvmProjectSystem.loadProjectItems source sets (#899)', () => {
  let root: string = '';

  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), 'studio-jvm-')));
    write({
      'notes.txt': '',
      'output/run.log': '',
      'build/classes/Main.class': '',
      'target/classes/Main.class': '',
      '.gradle/cache': '',
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
   * Loads a manifest's contents, listed by {@link flat}.
   * @param manifest The manifest's file name.
   * @returns Returns the paths.
   */
  async function load(manifest: string): Promise<string[]> {
    const items: ProjectItems | null = await new JvmProjectSystem().loadProjectItems(
      path.join(root, manifest),
    );
    return flat(items!.tree);
  }

  it('listsAMavenModulesSourceSets_leavingTheRestToTheFileExplorer', async () => {
    write({
      'pom.xml': '<project/>',
      'src/main/java/App.java': '',
      'src/main/resources/app.yml': '',
      'src/test/java/AppTest.java': '',
    });

    expect(await load('pom.xml')).toEqual([
      'src/',
      'src/main/',
      'src/main/java/',
      'src/main/java/App.java',
      'src/main/resources/',
      'src/main/resources/app.yml',
      'src/test/',
      'src/test/java/',
      'src/test/java/AppTest.java',
      'pom.xml',
    ]);
  });

  it('listsAGradleModulesBuildFiles_besideItsSourceSets', async () => {
    write({
      'build.gradle.kts': '',
      'settings.gradle.kts': '',
      'gradle.properties': '',
      'gradle/libs.versions.toml': '',
      'gradle/wrapper/gradle-wrapper.jar': '',
      'src/integrationTest/kotlin/AppIT.kt': '',
    });

    expect(await load('build.gradle.kts')).toEqual([
      'gradle/',
      'gradle/libs.versions.toml',
      'src/',
      'src/integrationTest/',
      'src/integrationTest/kotlin/',
      'src/integrationTest/kotlin/AppIT.kt',
      'build.gradle.kts',
      'gradle.properties',
      'settings.gradle.kts',
    ]);
  });

  it('keepsAPackageNamedLikeAnOutputFolder', async () => {
    write({
      'pom.xml': '<project/>',
      'src/main/java/org/build/Task.java': '',
      'src/main/java/org/bin/Tool.java': '',
    });

    expect(await load('pom.xml')).toEqual(
      expect.arrayContaining([
        'src/main/java/org/build/Task.java',
        'src/main/java/org/bin/Tool.java',
      ]),
    );
  });

  it('stillSkipsAFrontEndsDependencies_insideASourceSet', async () => {
    write({
      'pom.xml': '<project/>',
      'src/main/web/app.js': '',
      'src/main/web/node_modules/left-pad/index.js': '',
    });

    expect(await load('pom.xml')).not.toContain('src/main/web/node_modules/');
  });

  it('readsAFolderTheManifestDeclares', async () => {
    write({
      'pom.xml': '<project><build><sourceDirectory>java</sourceDirectory></build></project>',
      'java/App.java': '',
    });

    expect(await load('pom.xml')).toEqual(['java/', 'java/App.java', 'pom.xml']);
  });

  it('refusesADeclaredFolderOutsideTheModule_andDoesNotFollowALinkOutOfIt', async () => {
    const outside: string = realpathSync(mkdtempSync(path.join(tmpdir(), 'studio-outside-')));
    writeFileSync(path.join(outside, 'secret.java'), '');
    symlinkSync(outside, path.join(root, 'linked'));
    write({
      'build.gradle': `srcDirs = ['../${path.basename(outside)}', '${outside}', 'linked', '.']`,
      'src/main/java/App.java': '',
    });

    const listed: string[] = await load('build.gradle');
    rmSync(outside, { recursive: true, force: true });

    expect(listed).toEqual([
      'src/',
      'src/main/',
      'src/main/java/',
      'src/main/java/App.java',
      'build.gradle',
    ]);
  });

  it('fallsBackToTheListing_forAModuleWithNoSources', async () => {
    write({ 'pom.xml': '<project/>' });

    expect(await load('pom.xml')).toEqual(expect.arrayContaining(['notes.txt', 'output/run.log']));
  });
});
