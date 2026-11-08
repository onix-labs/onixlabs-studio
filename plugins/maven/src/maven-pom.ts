// Reads a POM: what it is, what it inherits from, what it declares and what it manages.
//
// Only what Studio shows is read: the project's coordinates, `<parent>`, `<properties>`, `<modules>`,
// `<repositories>`, the direct `<dependencies>` and `<dependencyManagement>`. Dependencies inside a
// `<profile>` or a `<plugin>` are not the project's own and are left out; a profile is active only in
// some builds, which a read of the file cannot know.

import { child, children, childText, descend, parseXml, XmlElement } from './xml';
import { PackageDependencyScope } from './protocol';

/**
 * A project's coordinates, any part of which a POM may leave to its parent.
 */
export interface MavenCoordinates {
  /**
   * Gets the group id, or null when it is inherited.
   */
  readonly groupId: string | null;

  /**
   * Gets the artifact id, or null when it is missing.
   */
  readonly artifactId: string | null;

  /**
   * Gets the version, or null when it is inherited.
   */
  readonly version: string | null;
}

/**
 * The `<parent>` a POM names.
 */
export interface MavenParent extends MavenCoordinates {
  /**
   * Gets where the parent's POM is, relative to this one: `../pom.xml` unless the POM says otherwise,
   * and null when it says the parent is not in the folder at all (an empty `<relativePath/>`).
   */
  readonly relativePath: string | null;
}

/**
 * One dependency, as written: the version and scope may hold `${property}` references still.
 */
export interface MavenDependency {
  /**
   * Gets the group id.
   */
  readonly groupId: string;

  /**
   * Gets the artifact id.
   */
  readonly artifactId: string;

  /**
   * Gets the version as written, or null when it is managed elsewhere.
   */
  readonly version: string | null;

  /**
   * Gets the scope as written, or null for the default (`compile`).
   */
  readonly scope: string | null;

  /**
   * Gets the packaging type as written, or null for the default (`jar`).
   */
  readonly type: string | null;

  /**
   * Gets whether the dependency is marked `<optional>true</optional>`.
   */
  readonly optional: boolean;
}

/**
 * A repository a POM declares.
 */
export interface MavenRepositoryDeclaration {
  /**
   * Gets the repository id, which `settings.xml` binds credentials and mirrors to.
   */
  readonly id: string;

  /**
   * Gets the repository URL.
   */
  readonly url: string;
}

/**
 * What a POM says, before anything is inherited or resolved.
 */
export interface MavenPom {
  /**
   * Gets the project's own coordinates.
   */
  readonly coordinates: MavenCoordinates;

  /**
   * Gets the parent it names, or null.
   */
  readonly parent: MavenParent | null;

  /**
   * Gets the properties it defines.
   */
  readonly properties: ReadonlyMap<string, string>;

  /**
   * Gets the module directories it aggregates, relative to it.
   */
  readonly modules: readonly string[];

  /**
   * Gets its direct dependencies.
   */
  readonly dependencies: readonly MavenDependency[];

  /**
   * Gets the dependencies it manages, imported BOMs among them (scope `import`, type `pom`).
   */
  readonly managed: readonly MavenDependency[];

  /**
   * Gets the repositories it declares.
   */
  readonly repositories: readonly MavenRepositoryDeclaration[];
}

/**
 * Reads a dependency element.
 * @param element The `<dependency>`.
 * @returns Returns the dependency, or null when it has no group or artifact id.
 */
function readDependency(element: XmlElement): MavenDependency | null {
  const groupId: string | null = childText(element, 'groupId');
  const artifactId: string | null = childText(element, 'artifactId');
  if (groupId === null || artifactId === null) {
    return null;
  }
  return {
    groupId,
    artifactId,
    version: childText(element, 'version'),
    scope: childText(element, 'scope'),
    type: childText(element, 'type'),
    optional: childText(element, 'optional')?.toLowerCase() === 'true',
  };
}

/**
 * Reads the `<dependency>` children of a `<dependencies>` element.
 * @param element The `<dependencies>`, or null.
 * @returns Returns the dependencies.
 */
function readDependencies(element: XmlElement | null): readonly MavenDependency[] {
  return children(element, 'dependency')
    .map(readDependency)
    .filter(
      (dependency: MavenDependency | null): dependency is MavenDependency => dependency !== null,
    );
}

/**
 * Reads a POM.
 * @param xml The POM's text.
 * @returns Returns what it says, or null when it is not a POM.
 */
export function parsePom(xml: string): MavenPom | null {
  const project: XmlElement | null = parseXml(xml);
  if (project?.name !== 'project') {
    return null;
  }
  const parentElement: XmlElement | null = child(project, 'parent');
  const relative: XmlElement | null = child(parentElement, 'relativePath');
  const properties: Map<string, string> = new Map<string, string>();
  for (const property of child(project, 'properties')?.children ?? []) {
    properties.set(property.name, property.text.trim());
  }
  return {
    coordinates: {
      groupId: childText(project, 'groupId'),
      artifactId: childText(project, 'artifactId'),
      version: childText(project, 'version'),
    },
    parent:
      parentElement === null
        ? null
        : {
            groupId: childText(parentElement, 'groupId'),
            artifactId: childText(parentElement, 'artifactId'),
            version: childText(parentElement, 'version'),
            relativePath: relative === null ? '../pom.xml' : relative.text.trim() || null,
          },
    properties,
    modules: children(child(project, 'modules'), 'module')
      .map((module: XmlElement): string => module.text.trim())
      .filter((module: string): boolean => module.length > 0),
    dependencies: readDependencies(child(project, 'dependencies')),
    managed: readDependencies(descend(project, 'dependencyManagement/dependencies')),
    repositories: children(child(project, 'repositories'), 'repository')
      .map((repository: XmlElement): MavenRepositoryDeclaration | null => {
        const id: string | null = childText(repository, 'id');
        const url: string | null = childText(repository, 'url');
        return id === null || url === null ? null : { id, url };
      })
      .filter(
        (repository: MavenRepositoryDeclaration | null): repository is MavenRepositoryDeclaration =>
          repository !== null,
      ),
  };
}

/**
 * Maps a Maven scope onto Studio's: `compile`, `runtime` and `system` are what the artifact needs to
 * run (production), `test` is development, and `provided` — supplied by the container that runs it —
 * is what Studio calls a peer. An optional dependency is optional whatever its scope, unless it is a
 * test one.
 * @param scope The Maven scope, or null for the default.
 * @param optional Whether it is marked optional.
 * @returns Returns Studio's scope.
 */
export function mapMavenScope(scope: string | null, optional: boolean): PackageDependencyScope {
  const name: string = (scope ?? 'compile').toLowerCase();
  if (name === 'test') {
    return 'development';
  }
  if (optional) {
    return 'optional';
  }
  return name === 'provided' ? 'peer' : 'production';
}

/**
 * Determines whether a managed dependency is an imported BOM.
 * @param dependency The managed dependency.
 * @returns Returns true for `<scope>import</scope>` with `<type>pom</type>`.
 */
export function isBomImport(dependency: MavenDependency): boolean {
  return dependency.scope?.toLowerCase() === 'import' && dependency.type?.toLowerCase() === 'pom';
}

/**
 * Replaces `${name}` references in a value with the properties' values, repeatedly so a property can
 * refer to another, and leaves a reference it cannot resolve as it is. `${env.…}` references are never
 * resolved: the plugin's environment is not the build's.
 * @param value The value.
 * @param properties The properties in force.
 * @returns Returns the value with what could be resolved, resolved.
 */
export function interpolate(value: string, properties: ReadonlyMap<string, string>): string {
  let current: string = value;
  for (let pass: number = 0; pass < 10 && current.includes('${'); pass += 1) {
    const next: string = current.replace(/\$\{([^}]+)\}/g, (match: string, name: string): string =>
      name.startsWith('env.') ? match : (properties.get(name) ?? match),
    );
    if (next === current) {
      break;
    }
    current = next;
  }
  return current;
}
