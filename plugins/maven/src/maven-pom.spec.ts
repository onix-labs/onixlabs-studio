import { describe, expect, it } from 'vitest';
import { interpolate, isBomImport, mapMavenScope, MavenPom, parsePom } from './maven-pom';

/**
 * A POM with every part the reader looks at, and some it must not.
 */
const POM: string = `<?xml version="1.0"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <parent>
    <groupId>com.example</groupId>
    <artifactId>parent</artifactId>
    <version>1.0.0</version>
  </parent>
  <artifactId>api</artifactId>
  <properties><jackson.version>2.17.0</jackson.version></properties>
  <modules><module>core</module><module> web </module></modules>
  <repositories><repository><id>corp</id><url>https://repo.example.com/maven</url></repository></repositories>
  <dependencyManagement><dependencies>
    <dependency><groupId>org.slf4j</groupId><artifactId>slf4j-api</artifactId><version>2.0.13</version></dependency>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-dependencies</artifactId><version>3.3.0</version><type>pom</type><scope>import</scope></dependency>
  </dependencies></dependencyManagement>
  <dependencies>
    <dependency><groupId>com.fasterxml.jackson.core</groupId><artifactId>jackson-databind</artifactId><version>\${jackson.version}</version></dependency>
    <dependency><groupId>org.junit.jupiter</groupId><artifactId>junit-jupiter</artifactId><scope>test</scope></dependency>
    <dependency><groupId>jakarta.servlet</groupId><artifactId>jakarta.servlet-api</artifactId><version>6.0.0</version><scope>provided</scope><optional>true</optional></dependency>
  </dependencies>
  <build><plugins><plugin><dependencies>
    <dependency><groupId>plugin</groupId><artifactId>only</artifactId><version>1</version></dependency>
  </dependencies></plugin></plugins></build>
  <profiles><profile><dependencies>
    <dependency><groupId>profile</groupId><artifactId>only</artifactId><version>1</version></dependency>
  </dependencies></profile></profiles>
</project>`;

describe('parsePom', () => {
  it('parsePom_aFullPom_readsCoordinatesParentPropertiesAndModules', () => {
    const pom: MavenPom | null = parsePom(POM);

    expect(pom?.coordinates).toEqual({ groupId: null, artifactId: 'api', version: null });
    expect(pom?.parent).toEqual({
      groupId: 'com.example',
      artifactId: 'parent',
      version: '1.0.0',
      relativePath: '../pom.xml',
    });
    expect(pom?.properties.get('jackson.version')).toBe('2.17.0');
    expect(pom?.modules).toEqual(['core', 'web']);
    expect(pom?.repositories).toEqual([{ id: 'corp', url: 'https://repo.example.com/maven' }]);
  });

  it('parsePom_dependencies_readsOnlyTheProjectsOwn', () => {
    const pom: MavenPom | null = parsePom(POM);

    expect(pom?.dependencies.map((dependency) => dependency.artifactId)).toEqual([
      'jackson-databind',
      'junit-jupiter',
      'jakarta.servlet-api',
    ]);
    expect(pom?.dependencies[1]).toMatchObject({ version: null, scope: 'test' });
    expect(pom?.dependencies[2]).toMatchObject({ scope: 'provided', optional: true });
  });

  it('parsePom_dependencyManagement_readsManagedVersionsAndBoms', () => {
    const pom: MavenPom | null = parsePom(POM);

    expect(pom?.managed).toHaveLength(2);
    expect(isBomImport(pom!.managed[0])).toBe(false);
    expect(isBomImport(pom!.managed[1])).toBe(true);
  });

  it('parsePom_anEmptyRelativePath_saysTheParentIsNotInTheFolder', () => {
    const pom: MavenPom | null = parsePom(
      '<project><parent><groupId>g</groupId><artifactId>p</artifactId><version>1</version><relativePath/></parent><artifactId>a</artifactId></project>',
    );

    expect(pom?.parent?.relativePath).toBeNull();
  });

  it('parsePom_notAPom_answersNull', () => {
    expect(parsePom('<settings/>')).toBeNull();
  });
});

describe('mapMavenScope', () => {
  it('mapMavenScope_mapsEachScope', () => {
    expect(mapMavenScope(null, false)).toBe('production');
    expect(mapMavenScope('runtime', false)).toBe('production');
    expect(mapMavenScope('test', false)).toBe('development');
    expect(mapMavenScope('provided', false)).toBe('peer');
    expect(mapMavenScope('compile', true)).toBe('optional');
    expect(mapMavenScope('test', true)).toBe('development');
  });
});

describe('interpolate', () => {
  it('interpolate_nestedReferences_resolvesThem', () => {
    const properties: ReadonlyMap<string, string> = new Map<string, string>([
      ['a', '${b}.1'],
      ['b', '2'],
    ]);

    expect(interpolate('${a}', properties)).toBe('2.1');
  });

  it('interpolate_unknownAndEnvironmentReferences_leavesThem', () => {
    const properties: ReadonlyMap<string, string> = new Map<string, string>([['env.HOME', 'x']]);

    expect(interpolate('${missing}-${env.HOME}', properties)).toBe('${missing}-${env.HOME}');
  });

  it('interpolate_aCycle_stops', () => {
    const properties: ReadonlyMap<string, string> = new Map<string, string>([
      ['a', '${b}'],
      ['b', '${a}'],
    ]);

    expect(interpolate('${a}', properties)).toMatch(/\$\{[ab]\}/);
  });
});
