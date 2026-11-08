// Reads a folder's Maven projects: every `pom.xml`, with what it inherits from parents in the folder.
//
// A POM's versions often live elsewhere: in a `${property}`, in its parent's `<properties>`, in a
// `<dependencyManagement>` up the chain, or in an imported BOM. All of those are followed while they are
// in the folder. A parent or BOM that is only in a repository (Spring Boot's, say) is not fetched: it
// imports further BOMs of its own, each needing its parent and its properties, and half of that chain
// would show versions that are wrong. Such a dependency says what manages it instead.
//
// Maven has no lockfile: a declared version is the version the build uses, so there is nothing to show
// as installed beyond what is declared.

import * as path from 'node:path';
import { findFiles, isWithin, readText } from './files';
import {
  interpolate,
  isBomImport,
  mapMavenScope,
  MavenDependency,
  MavenPom,
  parsePom,
} from './maven-pom';
import { MavenSettings, mirrors } from './maven-settings';
import { DeclaredPackage, ProjectRead, RepositoryCandidate } from './model';
import { MAVEN_CENTRAL, normaliseRepositoryUrl } from './repositories';
import { isConcreteVersion } from './versions';

/**
 * How many parents are followed before the chain is taken to be a cycle.
 */
const MAX_PARENTS: number = 10;

/**
 * One POM in the folder, read.
 */
interface PomFile {
  /**
   * Gets the absolute path.
   */
  readonly file: string;

  /**
   * Gets what it says.
   */
  readonly pom: MavenPom;
}

/**
 * What a POM's versions are resolved through.
 */
interface Resolution {
  /**
   * Gets the properties in force: the chain's, the child's winning, and the project's own coordinates.
   */
  readonly properties: ReadonlyMap<string, string>;

  /**
   * Gets the managed versions, by `group:artifact`.
   */
  readonly managed: ReadonlyMap<string, string>;

  /**
   * Gets what manages versions from outside the folder (a remote BOM or parent), in the user's terms,
   * or null when nothing does.
   */
  readonly remoteManager: string | null;
}

/**
 * Reads every Maven project under a folder.
 * @param root The absolute folder.
 * @param settings The user's Maven settings.
 * @returns Returns the projects, the shallowest first.
 */
export async function readMavenProjects(
  root: string,
  settings: MavenSettings,
): Promise<readonly ProjectRead[]> {
  const files: readonly string[] = await findFiles(
    root,
    (name: string): boolean => name === 'pom.xml',
  );
  const poms: PomFile[] = [];
  for (const file of files) {
    const text: string | null = await readText(file);
    const pom: MavenPom | null = text === null ? null : parsePom(text);
    if (pom !== null) {
      poms.push({ file, pom });
    }
  }
  const resolver: MavenResolver = new MavenResolver(root, poms);
  return poms.map((entry: PomFile): ProjectRead => resolver.project(entry, settings));
}

/**
 * Resolves POMs against each other: parents, properties, dependency management and local BOMs.
 */
class MavenResolver {
  /**
   * Holds the folder, which no parent outside of is read.
   */
  private readonly root: string;

  /**
   * Holds the folder's POMs.
   */
  private readonly poms: readonly PomFile[];

  /**
   * Holds each POM's resolution, once worked out.
   */
  private readonly resolutions: Map<string, Resolution> = new Map<string, Resolution>();

  /**
   * Initializes the resolver.
   * @param root The folder.
   * @param poms The folder's POMs.
   */
  public constructor(root: string, poms: readonly PomFile[]) {
    this.root = root;
    this.poms = poms;
  }

  /**
   * Builds one project's read.
   * @param entry The POM.
   * @param settings The user's settings.
   * @returns Returns the project.
   */
  public project(entry: PomFile, settings: MavenSettings): ProjectRead {
    const resolution: Resolution = this.resolve(entry, new Set<string>());
    const packages: DeclaredPackage[] = entry.pom.dependencies.map(
      (dependency: MavenDependency): DeclaredPackage => this.declared(dependency, resolution),
    );
    return {
      name:
        entry.pom.coordinates.artifactId === null
          ? path.basename(path.dirname(entry.file))
          : interpolate(entry.pom.coordinates.artifactId, resolution.properties),
      manifestPath: entry.file,
      packages,
      repositories: this.repositories(entry, settings),
    };
  }

  /**
   * Builds one dependency's row.
   * @param dependency The dependency.
   * @param resolution What it is resolved through.
   * @returns Returns the row.
   */
  private declared(dependency: MavenDependency, resolution: Resolution): DeclaredPackage {
    const name: string = `${interpolate(dependency.groupId, resolution.properties)}:${interpolate(dependency.artifactId, resolution.properties)}`;
    const version: string | null =
      dependency.version === null
        ? (resolution.managed.get(name) ?? null)
        : interpolate(dependency.version, resolution.properties);
    const requested: string =
      version ??
      (resolution.remoteManager === null ? '' : `managed by ${resolution.remoteManager}`);
    return {
      name,
      requested,
      current: version !== null && isConcreteVersion(version) ? version : null,
      installed: null,
      scope: mapMavenScope(dependency.scope, dependency.optional),
    };
  }

  /**
   * Works out what a POM's versions are resolved through.
   * @param entry The POM.
   * @param visiting The POMs being resolved, so a cycle stops.
   * @returns Returns the resolution.
   */
  private resolve(entry: PomFile, visiting: Set<string>): Resolution {
    const cached: Resolution | undefined = this.resolutions.get(entry.file);
    if (cached !== undefined) {
      return cached;
    }
    visiting.add(entry.file);
    const chain: PomFile[] = [entry];
    let remoteParent: string | null = null;
    for (let current: PomFile = entry; chain.length <= MAX_PARENTS;) {
      const parent: PomFile | null = this.parentOf(current);
      if (parent === null) {
        const named: MavenPom['parent'] = current.pom.parent;
        if (named !== null && named.artifactId !== null) {
          remoteParent = `${named.artifactId}${named.version === null ? '' : ` ${named.version}`}`;
        }
        break;
      }
      if (chain.includes(parent)) {
        break;
      }
      chain.push(parent);
      current = parent;
    }
    // Inheritance runs from the top of the chain down, so a child's property wins over its parent's.
    const ordered: readonly PomFile[] = [...chain].reverse();
    const properties: Map<string, string> = new Map<string, string>();
    for (const link of ordered) {
      for (const [key, value] of link.pom.properties) {
        properties.set(key, value);
      }
    }
    this.addCoordinates(entry.pom, properties);
    const managed: Map<string, string> = new Map<string, string>();
    const remoteBoms: string[] = [];
    for (const link of ordered) {
      for (const dependency of link.pom.managed) {
        const name: string = `${interpolate(dependency.groupId, properties)}:${interpolate(dependency.artifactId, properties)}`;
        if (isBomImport(dependency)) {
          const version: string =
            dependency.version === null ? '' : interpolate(dependency.version, properties);
          const local: PomFile | undefined = this.findByCoordinates(name);
          if (local !== undefined && !visiting.has(local.file)) {
            for (const [key, value] of this.resolve(local, visiting).managed) {
              managed.set(key, value);
            }
          } else {
            remoteBoms.push(`${dependency.artifactId}${version.length === 0 ? '' : ` ${version}`}`);
          }
        } else if (dependency.version !== null) {
          managed.set(name, interpolate(dependency.version, properties));
        }
      }
    }
    const resolution: Resolution = {
      properties,
      managed,
      remoteManager: remoteBoms.length > 0 ? remoteBoms.join(', ') : remoteParent,
    };
    visiting.delete(entry.file);
    this.resolutions.set(entry.file, resolution);
    return resolution;
  }

  /**
   * Adds the project's own coordinates as properties (`${project.version}` and the rest), inheriting a
   * group id or version from the parent where the POM leaves it out.
   * @param pom The POM.
   * @param properties The properties to add to.
   */
  private addCoordinates(pom: MavenPom, properties: Map<string, string>): void {
    const groupId: string | null = pom.coordinates.groupId ?? pom.parent?.groupId ?? null;
    const version: string | null = pom.coordinates.version ?? pom.parent?.version ?? null;
    const set: (key: string, value: string | null) => void = (
      key: string,
      value: string | null,
    ): void => {
      if (value !== null) {
        properties.set(key, value);
        properties.set(key.replace(/^project\./, 'pom.'), value);
      }
    };
    set('project.groupId', groupId);
    set('project.artifactId', pom.coordinates.artifactId);
    set('project.version', version);
    set('project.parent.groupId', pom.parent?.groupId ?? null);
    set('project.parent.version', pom.parent?.version ?? null);
  }

  /**
   * Finds a POM's parent in the folder: at its `relativePath` (`../pom.xml` by default) when the POM
   * there is the one named, otherwise any POM in the folder with the parent's coordinates.
   * @param entry The POM.
   * @returns Returns the parent, or null when it is not in the folder.
   */
  private parentOf(entry: PomFile): PomFile | null {
    const parent: MavenPom['parent'] = entry.pom.parent;
    if (parent?.artifactId == null) {
      return null;
    }
    const wanted: string = `${parent.groupId ?? ''}:${parent.artifactId}`;
    if (parent.relativePath !== null) {
      let candidate: string = path.resolve(path.dirname(entry.file), parent.relativePath);
      if (!candidate.endsWith('.xml')) {
        candidate = path.join(candidate, 'pom.xml');
      }
      const found: PomFile | undefined = this.poms.find(
        (pom: PomFile): boolean => pom.file === candidate,
      );
      if (
        found !== undefined &&
        isWithin(found.file, this.root) &&
        this.coordinatesOf(found) === wanted
      ) {
        return found;
      }
    }
    return this.findByCoordinates(wanted) ?? null;
  }

  /**
   * Finds a POM in the folder by its `group:artifact`.
   * @param name The coordinates.
   * @returns Returns the POM, or undefined.
   */
  private findByCoordinates(name: string): PomFile | undefined {
    return this.poms.find((pom: PomFile): boolean => this.coordinatesOf(pom) === name);
  }

  /**
   * Gets a POM's `group:artifact`, the group inherited from its parent when it leaves it out.
   * @param entry The POM.
   * @returns Returns the coordinates.
   */
  private coordinatesOf(entry: PomFile): string {
    const groupId: string = entry.pom.coordinates.groupId ?? entry.pom.parent?.groupId ?? '';
    return `${groupId}:${entry.pom.coordinates.artifactId ?? ''}`;
  }

  /**
   * Works out the repositories a project resolves from, as Maven would: the active profiles'
   * repositories, the POM chain's, and Maven Central last, each replaced by the first mirror that
   * stands in for it. A credential from `<servers>` goes only to the URL `settings.xml` itself gives its
   * id; a repository a POM declares gets one only when its URL is that same URL.
   * @param entry The POM.
   * @param settings The user's settings.
   * @returns Returns the repositories, without repeats.
   */
  private repositories(entry: PomFile, settings: MavenSettings): readonly RepositoryCandidate[] {
    const declared: { id: string; url: string }[] = [...settings.repositories];
    const seen: Set<string> = new Set<string>();
    for (let current: PomFile | null = entry; current !== null && !seen.has(current.file);) {
      seen.add(current.file);
      for (const repository of current.pom.repositories) {
        const url: string | null = normaliseRepositoryUrl(repository.url);
        if (url !== null) {
          declared.push({ id: repository.id, url });
        }
      }
      current = this.parentOf(current);
    }
    declared.push({ id: 'central', url: MAVEN_CENTRAL });
    // The URLs the user's own settings give each id: the only places that id's credential may go.
    const bound: Map<string, string> = new Map<string, string>();
    for (const mirror of settings.mirrors) {
      bound.set(mirror.id, mirror.url);
    }
    for (const repository of settings.repositories) {
      if (!bound.has(repository.id)) {
        bound.set(repository.id, repository.url);
      }
    }
    const candidates: RepositoryCandidate[] = [];
    for (const repository of declared) {
      const mirror: MavenSettings['mirrors'][number] | undefined = settings.mirrors.find(
        (candidate: MavenSettings['mirrors'][number]): boolean =>
          mirrors(candidate.mirrorOf, repository.id, repository.url),
      );
      const id: string = mirror?.id ?? repository.id;
      const url: string = mirror?.url ?? repository.url;
      if (candidates.some((candidate: RepositoryCandidate): boolean => candidate.url === url)) {
        continue;
      }
      const server: { username: string; password: string } | undefined = settings.servers.get(id);
      candidates.push({
        name: id,
        url,
        credential: server !== undefined && bound.get(id) === url ? server : null,
      });
    }
    return candidates;
  }
}
