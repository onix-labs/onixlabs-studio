import { describe, expect, it } from 'vitest';
import { parseVersionCatalog, resolveCatalogReference, VersionCatalog } from './gradle-catalog';

/**
 * A catalog with every way a library can be written.
 */
const CATALOG: string = `
[versions]
jackson = "2.17.0"
junit = { strictly = "5.10.2" }

[libraries]
jackson-databind = { module = "com.fasterxml.jackson.core:jackson-databind", version.ref = "jackson" }
jackson-core = { group = "com.fasterxml.jackson.core", name = "jackson-core", version = { ref = "jackson" } }
junit-jupiter = { module = "org.junit.jupiter:junit-jupiter", version.ref = "junit" }
okhttp = "com.squareup.okhttp3:okhttp:4.12.0"
spring-web = { module = "org.springframework:spring-web" }
missing-ref = { module = "a:b", version.ref = "nope" }
groovy = "org.apache.groovy:groovy:4.0.0"
groovy-json = "org.apache.groovy:groovy-json:4.0.0"

[bundles]
jackson = ["jackson-databind", "jackson_core"]

[plugins]
kotlin = { id = "org.jetbrains.kotlin.jvm", version = "2.0.0" }
`;

describe('parseVersionCatalog', () => {
  it('parseVersionCatalog_everyLibraryForm_resolvesModuleAndVersion', () => {
    const catalog: VersionCatalog = parseVersionCatalog(CATALOG);

    expect(catalog.libraries.get('jackson.databind')).toEqual({
      module: 'com.fasterxml.jackson.core:jackson-databind',
      version: '2.17.0',
    });
    expect(catalog.libraries.get('jackson.core')?.version).toBe('2.17.0');
    expect(catalog.libraries.get('junit.jupiter')?.version).toBe('5.10.2');
    expect(catalog.libraries.get('okhttp')).toEqual({
      module: 'com.squareup.okhttp3:okhttp',
      version: '4.12.0',
    });
    expect(catalog.libraries.get('spring.web')?.version).toBeNull();
    expect(catalog.libraries.get('missing.ref')?.version).toBeNull();
  });

  it('parseVersionCatalog_dottedAliases_areFlattened', () => {
    const catalog: VersionCatalog = parseVersionCatalog(
      '[libraries]\ncommons.lang = "org.apache.commons:commons-lang3:3.14.0"',
    );

    expect(catalog.libraries.get('commons.lang')?.module).toBe('org.apache.commons:commons-lang3');
  });
});

describe('resolveCatalogReference', () => {
  it('resolveCatalogReference_aLibrary_answersIt', () => {
    const catalog: VersionCatalog = parseVersionCatalog(CATALOG);

    expect(
      resolveCatalogReference(catalog, 'jackson.databind').map((entry) => entry.alias),
    ).toEqual(['jackson.databind']);
  });

  it('resolveCatalogReference_aBundle_answersEachLibrary', () => {
    const catalog: VersionCatalog = parseVersionCatalog(CATALOG);

    expect(
      resolveCatalogReference(catalog, 'bundles.jackson').map((entry) => entry.library.module),
    ).toEqual([
      'com.fasterxml.jackson.core:jackson-databind',
      'com.fasterxml.jackson.core:jackson-core',
    ]);
  });

  it('resolveCatalogReference_longestAliasWins_andATrailingCallIsIgnored', () => {
    const catalog: VersionCatalog = parseVersionCatalog(CATALOG);

    expect(resolveCatalogReference(catalog, 'groovy.json')[0].alias).toBe('groovy.json');
    expect(resolveCatalogReference(catalog, 'groovy.get')[0].alias).toBe('groovy');
  });

  it('resolveCatalogReference_versionsPluginsAndUnknown_answerNothing', () => {
    const catalog: VersionCatalog = parseVersionCatalog(CATALOG);

    expect(resolveCatalogReference(catalog, 'versions.jackson')).toEqual([]);
    expect(resolveCatalogReference(catalog, 'plugins.kotlin')).toEqual([]);
    expect(resolveCatalogReference(catalog, 'nothing.here')).toEqual([]);
  });
});
