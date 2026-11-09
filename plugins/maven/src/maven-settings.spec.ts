import { describe, expect, it } from 'vitest';
import { MavenSettings, mirrors, parseMavenSettings } from './maven-settings';

describe('parseMavenSettings', () => {
  it('parseMavenSettings_mirrorsServersAndActiveProfiles_readsThem', () => {
    const settings: MavenSettings = parseMavenSettings(`<settings>
      <mirrors><mirror><id>corp</id><url>https://nexus.example.com/repository/maven/</url><mirrorOf>central</mirrorOf></mirror></mirrors>
      <servers>
        <server><id>corp</id><username>me</username><password>secret</password></server>
        <server><id>env</id><username>me</username><password>\${env.TOKEN}</password></server>
        <server><id>encrypted</id><username>me</username><password>{COQLCE6DU6GtcS5P=}</password></server>
      </servers>
      <profiles>
        <profile><id>on</id><repositories><repository><id>gh</id><url>https://maven.pkg.github.com/o/r</url></repository></repositories></profile>
        <profile><id>default</id><activation><activeByDefault>true</activeByDefault></activation><repositories><repository><id>d</id><url>https://d.example.com</url></repository></repositories></profile>
        <profile><id>off</id><repositories><repository><id>off</id><url>https://off.example.com</url></repository></repositories></profile>
      </profiles>
      <activeProfiles><activeProfile>on</activeProfile></activeProfiles>
    </settings>`);

    expect(settings.mirrors).toEqual([
      { id: 'corp', url: 'https://nexus.example.com/repository/maven', mirrorOf: 'central' },
    ]);
    expect([...settings.servers.keys()]).toEqual(['corp']);
    expect(settings.repositories.map((repository) => repository.id)).toEqual(['gh', 'd']);
  });

  it('parseMavenSettings_notSettings_answersEmpty', () => {
    expect(parseMavenSettings('<project/>').mirrors).toEqual([]);
  });
});

describe('mirrors', () => {
  it('mirrors_patterns_matchAsMavenDoes', () => {
    expect(mirrors('*', 'anything', 'https://x')).toBe(true);
    expect(mirrors('central', 'central', 'https://x')).toBe(true);
    expect(mirrors('central', 'corp', 'https://x')).toBe(false);
    expect(mirrors('*,!corp', 'corp', 'https://x')).toBe(false);
    expect(mirrors('external:*', 'local', 'http://localhost:8081/repo')).toBe(false);
    expect(mirrors('external:*', 'corp', 'https://x')).toBe(true);
  });
});
