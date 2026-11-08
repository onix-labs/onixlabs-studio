// The JVM package manager: Maven and Gradle projects in one model, because both resolve from Maven
// repositories — the same coordinates, the same `maven-metadata.xml`, the same Maven Central — and a
// folder often holds both.
//
// Read-only: a write is a command for Studio to run, built in `commands.ts`.

import * as path from 'node:path';
import { gradleRestoreCommand, mavenRestoreCommand } from './commands';
import { isFile, isWithin } from './files';
import { BUILD_SCRIPTS, GradleLocation, locateGradleProject, readGradleProjects } from './gradle';
import { note } from './log';
import { readMavenProjects } from './maven';
import {
  MAVEN_CENTRAL_SEARCH,
  MAVEN_CENTRAL_SOURCE,
  searchMavenCentral,
} from './maven-central-search';
import { MavenSettings, readMavenSettings } from './maven-settings';
import { DeclaredPackage, ProjectRead, RepositoryCandidate } from './model';
import {
  CredentialAsk,
  HttpFetch,
  InstalledPackage,
  PackageCommand,
  PackageManagerModel,
  PackageProject,
  PackageSearchOptions,
  PackageSearchResult,
  PackageSourceInfo,
} from './protocol';
import {
  basicAuth,
  fetchVersionLists,
  isPublicRepository,
  mayCarryCredential,
  Repository,
} from './repositories';
import { deriveStatus, pickLatest } from './versions';

/**
 * Serves the JVM ecosystem.
 */
export class JvmPackageManager {
  /**
   * Holds how to ask Studio for a token saved for a repository.
   */
  private readonly credential: CredentialAsk;

  /**
   * Holds the address of Maven Central's search: the real one, or a loopback fake in a spec.
   */
  private readonly searchBase: string;

  /**
   * Initializes the manager.
   * @param credential Asks Studio for a token saved for a repository.
   * @param searchBase The address of Maven Central's search.
   */
  public constructor(credential: CredentialAsk, searchBase: string = MAVEN_CENTRAL_SEARCH) {
    this.credential = credential;
    this.searchBase = searchBase;
  }

  /**
   * Reads a folder's Maven and Gradle projects, what each declares, and the latest version of each
   * package from the repositories its build resolves from.
   * @param root The absolute folder.
   * @param fetchFn The fetch repository requests go through.
   * @returns Returns the model, or null when the folder holds no Maven or Gradle project.
   */
  public async load(root: string, fetchFn: HttpFetch): Promise<PackageManagerModel | null> {
    const settings: MavenSettings = await readMavenSettings();
    const projects: readonly ProjectRead[] = [
      ...(await readMavenProjects(root, settings)),
      ...(await readGradleProjects(root)),
    ];
    if (projects.length === 0) {
      return null;
    }
    const tokens: Map<string, Promise<string | null>> = new Map<string, Promise<string | null>>();
    // Projects resolving from the same repositories share one set of lookups.
    const groups: Map<string, { repositories: readonly Repository[]; names: Set<string> }> =
      new Map<string, { repositories: readonly Repository[]; names: Set<string> }>();
    const groupOf: Map<ProjectRead, string> = new Map<ProjectRead, string>();
    for (const project of projects) {
      const key: string = project.repositories
        .map((candidate: RepositoryCandidate): string => candidate.url)
        .join(' ');
      groupOf.set(project, key);
      let group: { repositories: readonly Repository[]; names: Set<string> } | undefined =
        groups.get(key);
      if (group === undefined) {
        group = {
          repositories: await this.authorise(project.repositories, tokens),
          names: new Set<string>(),
        };
        groups.set(key, group);
      }
      for (const declared of project.packages) {
        group.names.add(declared.name);
      }
    }
    const versions: Map<string, ReadonlyMap<string, readonly string[] | null>> = new Map<
      string,
      ReadonlyMap<string, readonly string[] | null>
    >();
    for (const [key, group] of groups) {
      versions.set(key, await fetchVersionLists(group.names, group.repositories, fetchFn));
    }
    const distinct: number = new Set<string>(
      projects.flatMap((project: ProjectRead): string[] =>
        project.packages.map((declared: DeclaredPackage): string => declared.name),
      ),
    ).size;
    note('maven', `Loaded ${projects.length} project(s), ${distinct} distinct package(s)`);
    return {
      ecosystem: 'maven',
      root,
      projects: projects.map((project: ProjectRead): PackageProject => ({
        name: project.name,
        manifestPath: project.manifestPath,
        packages: project.packages.map((declared: DeclaredPackage): InstalledPackage =>
          this.row(declared, versions.get(groupOf.get(project) ?? '')?.get(declared.name) ?? null),
        ),
      })),
    };
  }

  /**
   * Lists the sources that can be searched: Maven Central, the only JVM repository with a public
   * search. Private repositories are read for latest versions, but not offered for search.
   * @returns Returns the sources.
   */
  public listSources(): readonly PackageSourceInfo[] {
    return [{ name: MAVEN_CENTRAL_SOURCE }];
  }

  /**
   * Searches a source.
   * @param sourceName The source, which must be Maven Central.
   * @param query The text.
   * @param options The paging.
   * @param fetchFn The fetch the search goes through.
   * @returns Returns a page of results, empty for a source that is not Maven Central.
   */
  public async search(
    sourceName: string,
    query: string,
    options: PackageSearchOptions,
    fetchFn: HttpFetch,
  ): Promise<PackageSearchResult> {
    if (sourceName !== MAVEN_CENTRAL_SOURCE) {
      note('maven', 'A search named a source other than Maven Central');
      return { items: [], total: 0, hasMore: false };
    }
    return searchMavenCentral(this.searchBase, query, options.skip, options.take, fetchFn);
  }

  /**
   * Builds the command that resolves a project's dependencies.
   * @param root The absolute folder the request names.
   * @param project The project's build file, as the model reported it.
   * @returns Returns the command.
   * @throws When the file is not a Maven or Gradle build file in the folder.
   */
  public async restore(root: string, project: string): Promise<PackageCommand> {
    if (!path.isAbsolute(project) || !isWithin(project, root) || !(await isFile(project))) {
      throw new Error('That project is not in this folder.');
    }
    const name: string = path.basename(project);
    if (name === 'pom.xml') {
      return mavenRestoreCommand(project, await this.wrapper(path.dirname(project), root, 'mvnw'));
    }
    if (BUILD_SCRIPTS.includes(name)) {
      const location: GradleLocation = await locateGradleProject(project, root);
      return gradleRestoreCommand(
        location.buildRoot,
        location.projectPath,
        await this.wrapper(location.buildRoot, location.buildRoot, 'gradlew'),
      );
    }
    throw new Error(`${name} is not a Maven or Gradle build file.`);
  }

  /**
   * Finds the wrapper script that applies to a folder: in it, or in the nearest folder above it within
   * the workspace. `.cmd` / `.bat` on Windows.
   * @param directory The folder to start from.
   * @param root The highest folder to look in.
   * @param name The wrapper's name, without extension.
   * @returns Returns the wrapper's absolute path, or null when there is none.
   */
  private async wrapper(directory: string, root: string, name: string): Promise<string | null> {
    const file: string =
      process.platform === 'win32' ? `${name}${name === 'mvnw' ? '.cmd' : '.bat'}` : name;
    for (let current: string = directory; isWithin(current, root);) {
      const candidate: string = path.join(current, file);
      if (await isFile(candidate)) {
        return candidate;
      }
      const parent: string = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
    return null;
  }

  /**
   * Gives each repository the headers it is asked with: the credential its configuration binds to it,
   * else a token saved in Studio. A public repository is never sent or asked for one, nor is a URL a
   * credential may not travel to.
   * @param candidates The repositories.
   * @param tokens The tokens already asked for in this read, by URL, so each is asked for once.
   * @returns Returns the repositories.
   */
  private async authorise(
    candidates: readonly RepositoryCandidate[],
    tokens: Map<string, Promise<string | null>>,
  ): Promise<readonly Repository[]> {
    const repositories: Repository[] = [];
    for (const candidate of candidates) {
      const name: string = candidate.name;
      if (isPublicRepository(candidate.url) || !mayCarryCredential(candidate.url)) {
        repositories.push({ name, url: candidate.url, headers: {} });
        continue;
      }
      if (candidate.credential !== null) {
        repositories.push({
          name,
          url: candidate.url,
          headers: basicAuth(candidate.credential.username, candidate.credential.password),
        });
        continue;
      }
      if (!candidate.url.startsWith('https://')) {
        repositories.push({ name, url: candidate.url, headers: {} });
        continue;
      }
      let token: Promise<string | null> | undefined = tokens.get(candidate.url);
      if (token === undefined) {
        token = this.credential(candidate.url);
        tokens.set(candidate.url, token);
      }
      const saved: string | null = await token;
      repositories.push({
        name,
        url: candidate.url,
        headers: saved === null ? {} : basicAuth('', saved),
      });
    }
    return repositories;
  }

  /**
   * Builds a package's row.
   * @param declared What the project declares.
   * @param versions The versions its repositories list, or null.
   * @returns Returns the row.
   */
  private row(declared: DeclaredPackage, versions: readonly string[] | null): InstalledPackage {
    const baseline: string | null = declared.installed ?? declared.current;
    const latest: string | null = versions === null ? null : pickLatest(versions, baseline, false);
    return {
      name: declared.name,
      requested: declared.requested,
      installed: declared.installed,
      latest,
      status: deriveStatus(baseline, latest),
      scope: declared.scope,
    };
  }
}
