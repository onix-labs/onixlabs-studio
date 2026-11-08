import { describe, expect, it } from 'vitest';
import {
  GradleDeclaration,
  gradleScope,
  interpolateGradle,
  parseGradleDependencies,
  parseGradleLockfile,
  parseGradleRepositories,
  parseGradleSettings,
  parseProperties,
  parseScriptVariables,
  removeBlocks,
  stripComments,
} from './gradle-scripts';

describe('parseGradleDependencies', () => {
  it('parseGradleDependencies_kotlinStringNotation_readsEachDeclaration', () => {
    const declarations: readonly GradleDeclaration[] = parseGradleDependencies(`
      plugins { id("org.jetbrains.kotlin.jvm") version "2.0.0" }
      dependencies {
        implementation("com.squareup.okhttp3:okhttp:4.12.0")
        testImplementation("org.junit.jupiter:junit-jupiter:5.10.2") { because("tests") }
        implementation(platform("org.springframework.boot:spring-boot-dependencies:3.3.0"))
        implementation("org.springframework.boot:spring-boot-starter-web")
        implementation(project(":core"))
        println("not:a:dependency")
      }`);

    expect(declarations).toEqual([
      {
        configuration: 'implementation',
        kind: 'coordinates',
        notation: 'com.squareup.okhttp3:okhttp',
        version: '4.12.0',
      },
      {
        configuration: 'testImplementation',
        kind: 'coordinates',
        notation: 'org.junit.jupiter:junit-jupiter',
        version: '5.10.2',
      },
      {
        configuration: 'implementation',
        kind: 'coordinates',
        notation: 'org.springframework.boot:spring-boot-dependencies',
        version: '3.3.0',
      },
      {
        configuration: 'implementation',
        kind: 'coordinates',
        notation: 'org.springframework.boot:spring-boot-starter-web',
        version: null,
      },
    ]);
  });

  it('parseGradleDependencies_groovyStringAndMapNotation_readsThem', () => {
    const declarations: readonly GradleDeclaration[] = parseGradleDependencies(`
      dependencies {
        implementation 'com.google.guava:guava:33.0.0-jre'
        compileOnly group: 'org.projectlombok', name: 'lombok', version: '1.18.32'
        runtimeOnly(group = "org.postgresql", name = "postgresql", version = "42.7.3")
        annotationProcessor "org.mapstruct:mapstruct-processor:$mapstructVersion"
      }`);

    expect(declarations.map((declaration) => [declaration.notation, declaration.version])).toEqual([
      ['com.google.guava:guava', '33.0.0-jre'],
      ['org.projectlombok:lombok', '1.18.32'],
      ['org.postgresql:postgresql', '42.7.3'],
      ['org.mapstruct:mapstruct-processor', '$mapstructVersion'],
    ]);
  });

  it('parseGradleDependencies_catalogReferences_readsTheAccessor', () => {
    const declarations: readonly GradleDeclaration[] = parseGradleDependencies(`
      dependencies {
        implementation(libs.jackson.databind)
        testImplementation(libs.bundles.testing)
        implementation platform(libs.spring.bom)
        alias(libs.plugins.kotlin)
      }`);

    expect(declarations.map((declaration) => declaration.notation)).toEqual([
      'jackson.databind',
      'bundles.testing',
      'spring.bom',
    ]);
  });

  it('parseGradleDependencies_commentsAndConstraints_areNotRead', () => {
    const declarations: readonly GradleDeclaration[] = parseGradleDependencies(`
      dependencies {
        // implementation("commented:out:1")
        /* implementation("block:comment:1") */
        constraints { implementation("constraint:only:1") { because("cve") } }
        implementation("kept:one:1") // with a trailing https://example.com comment
      }`);

    expect(declarations.map((declaration) => declaration.notation)).toEqual(['kept:one']);
  });
});

describe('gradleScope', () => {
  it('gradleScope_mapsConfigurations', () => {
    expect(gradleScope('implementation')).toBe('production');
    expect(gradleScope('api')).toBe('production');
    expect(gradleScope('debugImplementation')).toBe('production');
    expect(gradleScope('runtimeOnly')).toBe('production');
    expect(gradleScope('compileOnly')).toBe('peer');
    expect(gradleScope('testCompileOnly')).toBe('development');
    expect(gradleScope('testImplementation')).toBe('development');
    expect(gradleScope('androidTestImplementation')).toBe('development');
    expect(gradleScope('kapt')).toBe('development');
    expect(gradleScope('classpath')).toBe('development');
  });
});

describe('parseGradleRepositories', () => {
  it('parseGradleRepositories_shorthandsAndMavenBlocks_readsThemInOrder', () => {
    expect(
      parseGradleRepositories(`
        repositories {
          mavenCentral()
          maven("https://jitpack.io")
          maven {
            name = "corp"
            url = uri("https://repo.example.com/maven")
            credentials(PasswordCredentials::class)
          }
          maven { url 'https://plain.example.com' }
          google()
        }`),
    ).toEqual([
      { url: 'https://repo.maven.apache.org/maven2', name: null, credentials: false },
      { url: 'https://jitpack.io', name: null, credentials: false },
      { url: 'https://repo.example.com/maven', name: 'corp', credentials: true },
      { url: 'https://plain.example.com', name: null, credentials: false },
      { url: 'https://dl.google.com/dl/android/maven2', name: null, credentials: false },
    ]);
  });
});

describe('parseGradleSettings', () => {
  it('parseGradleSettings_includesInEveryForm_mapsPathsToFolders', () => {
    const settings: ReturnType<typeof parseGradleSettings> = parseGradleSettings(`
      rootProject.name = "shop"
      include(":app", ":lib:core")
      include 'web'
      includeBuild("build-logic")
      project(':web').projectDir = file('frontend/web')`);

    expect(settings.rootName).toBe('shop');
    expect([...settings.projects]).toEqual([
      [':app', 'app'],
      [':lib:core', 'lib/core'],
      [':web', 'frontend/web'],
    ]);
  });
});

describe('script helpers', () => {
  it('parseProperties_readsKeysAndSkipsComments', () => {
    expect([...parseProperties('# c\n! c\na=1\nb : two\n\nc=')]).toEqual([
      ['a', '1'],
      ['b', 'two'],
      ['c', ''],
    ]);
  });

  it('parseScriptVariables_readsLiteralAssignments', () => {
    const variables: ReadonlyMap<string, string> = parseScriptVariables(`
      val kotlinVersion = "2.0.0"
      def jacksonVersion = '2.17.0'
      ext.springVersion = '6.1.0'
      extra["okVersion"] = "4.12.0"
      val computed = "$kotlinVersion-x"`);

    expect(variables.get('kotlinVersion')).toBe('2.0.0');
    expect(variables.get('jacksonVersion')).toBe('2.17.0');
    expect(variables.get('springVersion')).toBe('6.1.0');
    expect(variables.get('okVersion')).toBe('4.12.0');
    expect(variables.has('computed')).toBe(false);
  });

  it('interpolateGradle_resolvesKnownAndLeavesUnknown', () => {
    const variables: ReadonlyMap<string, string> = new Map<string, string>([['v', '1.0']]);

    expect(interpolateGradle('$v ${v} ${project.v} $missing', variables)).toBe(
      '1.0 1.0 1.0 $missing',
    );
  });

  it('parseGradleLockfile_readsLockedVersions', () => {
    const locked: ReadonlyMap<string, string> = parseGradleLockfile(
      '# comment\ncom.google.guava:guava:33.0.0-jre=compileClasspath,runtimeClasspath\nempty=annotationProcessor\n',
    );

    expect([...locked]).toEqual([['com.google.guava:guava', '33.0.0-jre']]);
  });

  it('stripComments_keepsStringsHoldingSlashes', () => {
    expect(stripComments('a("https://x") // c\n/* b */d').trim()).toBe('a("https://x") \n d');
  });

  it('removeBlocks_blanksNestedBlocks', () => {
    expect(removeBlocks('a { b { c } } d', 'a').trim()).toBe('d');
  });
});
