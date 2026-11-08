import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JvmPackageManager } from './jvm';
import type {
  HttpFetch,
  HttpResponse,
  InstalledPackage,
  PackageManagerModel,
  PackageProject,
} from './protocol';

/**
 * The versions the fake repositories list, by `group/artifact` path.
 */
const PUBLISHED: Readonly<Record<string, readonly string[]>> = {
  'com/fasterxml/jackson/core/jackson-databind': ['2.15.0', '2.17.0', '2.18.0-rc1'],
  'org/slf4j/slf4j-api': ['2.0.0'],
  'org/apache/commons/commons-lang3': ['3.12.0', '3.14.0'],
  'org/springframework/boot/spring-boot-starter-web': ['3.3.0', '3.4.0'],
  'com/squareup/okhttp3/okhttp': ['4.11.0', '4.12.0'],
  'com/google/guava/guava': ['32.0.0-jre', '33.0.0-jre', '33.0.0-android'],
  'org/junit/jupiter/junit-jupiter': ['5.10.2'],
};

/**
 * One request the fake saw.
 */
interface Asked {
  /**
   * Gets the URL.
   */
  readonly url: string;

  /**
   * Gets the Authorization header, if any.
   */
  readonly authorization: string | undefined;
}

/**
 * Builds a fake fetch over {@link PUBLISHED}, answering from any repository, recording every request.
 * @param asked Where requests are recorded.
 * @returns Returns the fetch.
 */
function fakeRepositories(asked: Asked[]): HttpFetch {
  return (url: string, init?: { headers?: Record<string, string> }): Promise<HttpResponse> => {
    asked.push({ url, authorization: init?.headers?.['Authorization'] });
    const key: string | undefined = Object.keys(PUBLISHED).find((candidate: string): boolean =>
      url.endsWith(`/${candidate}/maven-metadata.xml`),
    );
    const body: string =
      key === undefined
        ? ''
        : `<metadata><versioning><versions>${PUBLISHED[key].map((version: string): string => `<version>${version}</version>`).join('')}</versions></versioning></metadata>`;
    return Promise.resolve({
      ok: key !== undefined,
      status: key === undefined ? 404 : 200,
      json: (): Promise<unknown> => Promise.resolve({}),
      text: (): Promise<string> => Promise.resolve(body),
    });
  };
}

/**
 * Writes a file, making its folder.
 * @param file The absolute path.
 * @param text The content.
 */
function write(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

/**
 * Finds a package in a project.
 * @param project The project.
 * @param name The package's name.
 * @returns Returns the package.
 */
function pkg(project: PackageProject | undefined, name: string): InstalledPackage | undefined {
  return project?.packages.find((candidate: InstalledPackage): boolean => candidate.name === name);
}

describe('JvmPackageManager', () => {
  let scratch: string = '';
  let root: string = '';
  let home: string = '';

  beforeEach(() => {
    scratch = realpathSync(mkdtempSync(path.join(tmpdir(), 'studio-maven-')));
    root = path.join(scratch, 'workspace');
    home = path.join(scratch, 'home');
    mkdirSync(root);
    mkdirSync(home);
    // The user's own ~/.m2/settings.xml and ~/.gradle hold repository passwords, and have no place in
    // a spec.
    vi.stubEnv('HOME', home);
    vi.stubEnv('USERPROFILE', home);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(scratch, { recursive: true, force: true });
  });

  describe('Maven', () => {
    beforeEach(() => {
      write(
        path.join(root, 'pom.xml'),
        `<project>
          <groupId>com.example</groupId><artifactId>shop</artifactId><version>1.0.0</version>
          <packaging>pom</packaging>
          <modules><module>api</module><module>bom</module></modules>
          <properties><jackson.version>2.15.0</jackson.version><slf4j.version>2.0.0</slf4j.version></properties>
          <dependencyManagement><dependencies>
            <dependency><groupId>org.slf4j</groupId><artifactId>slf4j-api</artifactId><version>\${slf4j.version}</version></dependency>
            <dependency><groupId>com.example</groupId><artifactId>shop-bom</artifactId><version>\${project.version}</version><type>pom</type><scope>import</scope></dependency>
            <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-dependencies</artifactId><version>3.3.0</version><type>pom</type><scope>import</scope></dependency>
          </dependencies></dependencyManagement>
        </project>`,
      );
      write(
        path.join(root, 'bom', 'pom.xml'),
        `<project>
          <parent><groupId>com.example</groupId><artifactId>shop</artifactId><version>1.0.0</version></parent>
          <artifactId>shop-bom</artifactId><packaging>pom</packaging>
          <dependencyManagement><dependencies>
            <dependency><groupId>org.apache.commons</groupId><artifactId>commons-lang3</artifactId><version>3.12.0</version></dependency>
          </dependencies></dependencyManagement>
        </project>`,
      );
      write(
        path.join(root, 'api', 'pom.xml'),
        `<project>
          <parent><groupId>com.example</groupId><artifactId>shop</artifactId><version>1.0.0</version></parent>
          <artifactId>shop-api</artifactId>
          <repositories><repository><id>corp-releases</id><url>https://evil.example.com/maven</url></repository></repositories>
          <dependencies>
            <dependency><groupId>com.fasterxml.jackson.core</groupId><artifactId>jackson-databind</artifactId><version>\${jackson.version}</version></dependency>
            <dependency><groupId>org.slf4j</groupId><artifactId>slf4j-api</artifactId></dependency>
            <dependency><groupId>org.apache.commons</groupId><artifactId>commons-lang3</artifactId></dependency>
            <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency>
            <dependency><groupId>org.junit.jupiter</groupId><artifactId>junit-jupiter</artifactId><version>5.10.2</version><scope>test</scope></dependency>
            <dependency><groupId>jakarta.servlet</groupId><artifactId>jakarta.servlet-api</artifactId><version>[6.0,7.0)</version><scope>provided</scope></dependency>
          </dependencies>
        </project>`,
      );
    });

    it('load_aMultiModuleBuild_resolvesPropertiesManagementAndLocalBoms', async () => {
      const manager: JvmPackageManager = new JvmPackageManager(() => Promise.resolve(null));

      const model: PackageManagerModel | null = await manager.load(root, fakeRepositories([]));

      expect(model?.ecosystem).toBe('maven');
      expect(model?.projects.map((project: PackageProject): string => project.name)).toEqual([
        'shop',
        'shop-api',
        'shop-bom',
      ]);
      const api: PackageProject | undefined = model?.projects[1];
      expect(pkg(api, 'com.fasterxml.jackson.core:jackson-databind')).toEqual({
        name: 'com.fasterxml.jackson.core:jackson-databind',
        requested: '2.15.0',
        installed: null,
        latest: '2.17.0',
        status: 'outdated',
        scope: 'production',
      });
      expect(pkg(api, 'org.slf4j:slf4j-api')).toMatchObject({
        requested: '2.0.0',
        status: 'current',
      });
      expect(pkg(api, 'org.apache.commons:commons-lang3')).toMatchObject({
        requested: '3.12.0',
        latest: '3.14.0',
        status: 'outdated',
      });
      expect(pkg(api, 'org.springframework.boot:spring-boot-starter-web')).toMatchObject({
        requested: 'managed by spring-boot-dependencies 3.3.0',
        latest: '3.4.0',
        status: 'unknown',
      });
      expect(pkg(api, 'org.junit.jupiter:junit-jupiter')?.scope).toBe('development');
      expect(pkg(api, 'jakarta.servlet:jakarta.servlet-api')).toMatchObject({
        scope: 'peer',
        status: 'unknown',
      });
    });

    it('load_settingsMirrorsAndServers_bindCredentialsToTheirOwnUrls', async () => {
      write(
        path.join(home, '.m2', 'settings.xml'),
        `<settings>
          <mirrors><mirror><id>corp</id><url>https://nexus.example.com/maven2</url><mirrorOf>central</mirrorOf></mirror></mirrors>
          <servers>
            <server><id>corp</id><username>me</username><password>secret</password></server>
            <server><id>corp-releases</id><username>me</username><password>releases-secret</password></server>
          </servers>
          <profiles><profile><id>corp</id>
            <repositories><repository><id>corp-releases</id><url>https://nexus.example.com/releases</url></repository></repositories>
          </profile></profiles>
          <activeProfiles><activeProfile>corp</activeProfile></activeProfiles>
        </settings>`,
      );
      const asked: Asked[] = [];
      const studioAsks: string[] = [];
      const manager: JvmPackageManager = new JvmPackageManager((registry: string) => {
        studioAsks.push(registry);
        return Promise.resolve(null);
      });

      await manager.load(root, fakeRepositories(asked));

      const authorisationFor: (host: string) => Set<string | undefined> = (
        host: string,
      ): Set<string | undefined> =>
        new Set<string | undefined>(
          asked
            .filter((request: Asked): boolean => request.url.startsWith(host))
            .map((request: Asked): string | undefined => request.authorization),
        );
      expect(authorisationFor('https://nexus.example.com/maven2')).toEqual(
        new Set<string>([`Basic ${Buffer.from('me:secret').toString('base64')}`]),
      );
      expect(authorisationFor('https://nexus.example.com/releases')).toEqual(
        new Set<string>([`Basic ${Buffer.from('me:releases-secret').toString('base64')}`]),
      );
      // The POM's own repository shares the id but not the URL: it gets no password, and Studio is
      // asked for a token of its own instead.
      expect(authorisationFor('https://evil.example.com')).toEqual(new Set<undefined>([undefined]));
      expect(studioAsks).toEqual(['https://evil.example.com/maven']);
      expect(
        asked.some((request: Asked): boolean =>
          request.url.startsWith('https://repo.maven.apache.org'),
        ),
      ).toBe(false);
    });

    it('restore_aModule_runsTheNearestWrapperOnItsPom', async () => {
      write(path.join(root, 'mvnw'), '#!/bin/sh\n');
      const manager: JvmPackageManager = new JvmPackageManager(() => Promise.resolve(null));

      await expect(manager.restore(root, path.join(root, 'api', 'pom.xml'))).resolves.toEqual({
        executable: path.join(root, 'mvnw'),
        args: ['-f', 'pom.xml', 'dependency:resolve'],
        cwd: path.join(root, 'api'),
        title: 'Resolve dependencies',
      });
    });
  });

  describe('Gradle', () => {
    beforeEach(() => {
      write(path.join(root, 'settings.gradle.kts'), 'rootProject.name = "shop"\ninclude(":app")\n');
      write(
        path.join(root, 'build.gradle.kts'),
        `plugins { java }
        repositories {
          mavenCentral()
          maven { name = "corp"; url = uri("https://corp.example.com/maven"); credentials(PasswordCredentials::class) }
          maven { name = "other"; url = uri("https://other.example.com/maven"); credentials(PasswordCredentials::class) }
        }`,
      );
      write(
        path.join(root, 'gradle.properties'),
        'okhttpVersion=4.11.0\ncorpUsername=me\ncorpPassword=corp-secret\n',
      );
      write(
        path.join(root, 'gradle', 'libs.versions.toml'),
        `[versions]
        jackson = "2.15.0"
        [libraries]
        jackson-databind = { module = "com.fasterxml.jackson.core:jackson-databind", version.ref = "jackson" }
        junit-jupiter = "org.junit.jupiter:junit-jupiter:5.10.2"
        [bundles]
        testing = ["junit-jupiter"]`,
      );
      write(
        path.join(root, 'app', 'build.gradle.kts'),
        `dependencies {
          implementation(libs.jackson.databind)
          implementation("com.squareup.okhttp3:okhttp:$okhttpVersion")
          implementation("com.google.guava:guava:32.0.0-jre")
          compileOnly("org.projectlombok:lombok:1.18.32")
          testImplementation(libs.bundles.testing)
        }`,
      );
      write(
        path.join(root, 'app', 'gradle.lockfile'),
        'com.google.guava:guava:33.0.0-jre=compileClasspath\n',
      );
      // A user-level password keyed by repository name only: never used, whatever the build names.
      write(
        path.join(home, '.gradle', 'gradle.properties'),
        'otherUsername=me\notherPassword=user-secret\n',
      );
    });

    it('load_aBuildWithACatalogAndLockfile_resolvesEveryDeclaration', async () => {
      const manager: JvmPackageManager = new JvmPackageManager(() => Promise.resolve(null));

      const model: PackageManagerModel | null = await manager.load(root, fakeRepositories([]));

      expect(model?.projects.map((project: PackageProject): string => project.name)).toEqual([
        'shop',
        ':app',
      ]);
      const app: PackageProject | undefined = model?.projects[1];
      expect(pkg(app, 'com.fasterxml.jackson.core:jackson-databind')).toMatchObject({
        requested: '2.15.0',
        latest: '2.17.0',
        status: 'outdated',
        scope: 'production',
      });
      expect(pkg(app, 'com.squareup.okhttp3:okhttp')).toMatchObject({
        requested: '4.11.0',
        latest: '4.12.0',
      });
      expect(pkg(app, 'com.google.guava:guava')).toMatchObject({
        requested: '32.0.0-jre',
        installed: '33.0.0-jre',
        latest: '33.0.0-jre',
        status: 'current',
      });
      expect(pkg(app, 'org.projectlombok:lombok')).toMatchObject({ scope: 'peer', latest: null });
      expect(pkg(app, 'org.junit.jupiter:junit-jupiter')).toMatchObject({
        scope: 'development',
        status: 'current',
      });
    });

    it('load_repositoryCredentials_comeFromTheBuildsOwnPropertiesOrStudio', async () => {
      const asked: Asked[] = [];
      const manager: JvmPackageManager = new JvmPackageManager((registry: string) =>
        Promise.resolve(registry === 'https://other.example.com/maven' ? 'studio-token' : null),
      );

      await manager.load(root, fakeRepositories(asked));

      const first: (host: string) => string | undefined = (host: string): string | undefined =>
        asked.find((request: Asked): boolean => request.url.startsWith(host))?.authorization;
      expect(first('https://corp.example.com')).toBe(
        `Basic ${Buffer.from('me:corp-secret').toString('base64')}`,
      );
      expect(first('https://other.example.com')).toBe(
        `Basic ${Buffer.from(':studio-token').toString('base64')}`,
      );
      expect(first('https://repo.maven.apache.org')).toBeUndefined();
    });

    it('restore_aSubproject_runsItsTaskFromTheBuildRoot', async () => {
      write(path.join(root, 'gradlew'), '#!/bin/sh\n');
      const manager: JvmPackageManager = new JvmPackageManager(() => Promise.resolve(null));

      await expect(
        manager.restore(root, path.join(root, 'app', 'build.gradle.kts')),
      ).resolves.toEqual({
        executable: path.join(root, 'gradlew'),
        args: [':app:dependencies'],
        cwd: root,
        title: 'Resolve dependencies',
      });
    });
  });

  it('load_aFolderWithNoBuild_answersNull', async () => {
    const manager: JvmPackageManager = new JvmPackageManager(() => Promise.resolve(null));

    await expect(manager.load(root, fakeRepositories([]))).resolves.toBeNull();
  });

  it('restore_aFileOutsideTheFolderOrNotABuildFile_isRefused', async () => {
    write(path.join(scratch, 'pom.xml'), '<project/>');
    write(path.join(root, 'notes.txt'), 'x');
    const manager: JvmPackageManager = new JvmPackageManager(() => Promise.resolve(null));

    await expect(manager.restore(root, path.join(scratch, 'pom.xml'))).rejects.toThrow(
      'not in this folder',
    );
    await expect(manager.restore(root, path.join(root, 'notes.txt'))).rejects.toThrow(
      'is not a Maven or Gradle build file',
    );
  });
});
