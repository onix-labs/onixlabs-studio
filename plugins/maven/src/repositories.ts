// Maven repositories: where a version list is fetched from, and with what credential.
//
// Maven and Gradle both resolve from Maven repositories, and every Maven repository publishes, for each
// artifact, a `maven-metadata.xml` listing its versions — Maven Central, a Nexus or Artifactory, GitHub
// Packages, Google's Android repository alike. So that one file is how the latest version is found,
// whichever tool the project builds with.

import { note } from './log';
import { HttpFetch, HttpResponse } from './protocol';
import { children, descend, parseXml, XmlElement } from './xml';

/**
 * Maven Central, the repository every Maven build has unless a mirror replaces it, and the one a Gradle
 * build's `mavenCentral()` names.
 */
export const MAVEN_CENTRAL: string = 'https://repo.maven.apache.org/maven2';

/**
 * The public repositories, which no credential is ever sent to or asked for.
 */
const PUBLIC_HOSTS: ReadonlySet<string> = new Set<string>([
  'repo.maven.apache.org',
  'repo1.maven.org',
  'maven.google.com',
  'dl.google.com',
  'plugins.gradle.org',
]);

/**
 * How many version lists are fetched at once.
 */
const CONCURRENCY: number = 8;

/**
 * A repository a version list can be fetched from.
 */
export interface Repository {
  /**
   * Gets the name the repository is logged and shown by. ⛔ Never a URL, so never a credential.
   */
  readonly name: string;

  /**
   * Gets the repository's base URL, with no trailing slash and no user information.
   */
  readonly url: string;

  /**
   * Gets the headers every request to it carries: its credential, when it has one.
   */
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * Normalises a repository URL: no trailing slash, no user information (a credential written into a URL
 * is never used, and never repeated anywhere), and only http or https.
 * @param url The URL as configured.
 * @returns Returns the URL, or null when it is not an http or https URL.
 */
export function normaliseRepositoryUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return null;
  }
  parsed.username = '';
  parsed.password = '';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/+$/, '');
}

/**
 * Determines whether a repository is a public one, which no credential is sent to or asked for.
 * @param url The repository URL.
 * @returns Returns true for Maven Central, Google's repository and the Gradle Plugin Portal.
 */
export function isPublicRepository(url: string): boolean {
  try {
    return PUBLIC_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Determines whether a credential may be sent to a URL: over https, or over plain http only to this
 * machine's loopback interface. ⛔ Never over plain http to anywhere else, where anyone on the way
 * could read it.
 * @param url The URL.
 * @returns Returns true when a credential may travel to it.
 */
export function mayCarryCredential(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === 'https:') {
    return true;
  }
  return (
    parsed.protocol === 'http:' &&
    ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname.toLowerCase())
  );
}

/**
 * Builds the HTTP basic authorization header Maven repositories take.
 * @param username The user name, empty when the repository wants only a token.
 * @param password The password or token.
 * @returns Returns the headers.
 */
export function basicAuth(username: string, password: string): Record<string, string> {
  return {
    Authorization: `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`,
  };
}

/**
 * Reads the versions a `maven-metadata.xml` lists.
 * @param xml The metadata.
 * @returns Returns the versions, in the order listed.
 */
export function parseMetadataVersions(xml: string): readonly string[] {
  const root: XmlElement | null = parseXml(xml);
  return children(descend(root, 'versioning/versions'), 'version')
    .map((element: XmlElement): string => element.text.trim())
    .filter((version: string): boolean => version.length > 0);
}

/**
 * Builds the URL of an artifact's metadata in a repository.
 * @param repository The repository's base URL.
 * @param groupId The group id.
 * @param artifactId The artifact id.
 * @returns Returns the URL.
 */
export function metadataUrl(repository: string, groupId: string, artifactId: string): string {
  return `${repository}/${groupId.split('.').map(encodeURIComponent).join('/')}/${encodeURIComponent(artifactId)}/maven-metadata.xml`;
}

/**
 * Fetches the version lists of many artifacts, each from the first repository that has it, a bounded
 * number at once. A repository that cannot be reached is asked nothing more for the rest of the call,
 * so one dead repository costs one timeout and not one per package.
 * @param names The artifacts, as `group:artifact`.
 * @param repositories The repositories, in the order they are tried.
 * @param fetchFn The fetch requests go through.
 * @returns Returns each artifact's versions, or null where no repository had it.
 */
export async function fetchVersionLists(
  names: ReadonlySet<string>,
  repositories: readonly Repository[],
  fetchFn: HttpFetch,
): Promise<ReadonlyMap<string, readonly string[] | null>> {
  const results: Map<string, readonly string[] | null> = new Map<
    string,
    readonly string[] | null
  >();
  const dead: Set<string> = new Set<string>();
  const queue: string[] = [...names];
  const worker: () => Promise<void> = async (): Promise<void> => {
    for (let name: string | undefined = queue.shift(); name !== undefined; name = queue.shift()) {
      results.set(name, await versionsOf(name, repositories, fetchFn, dead));
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, (): Promise<void> => worker()),
  );
  return results;
}

/**
 * Fetches one artifact's versions from the first repository that has it.
 * @param name The artifact, as `group:artifact`.
 * @param repositories The repositories, in order.
 * @param fetchFn The fetch requests go through.
 * @param dead The repositories that could not be reached, which are skipped.
 * @returns Returns the versions, or null.
 */
async function versionsOf(
  name: string,
  repositories: readonly Repository[],
  fetchFn: HttpFetch,
  dead: Set<string>,
): Promise<readonly string[] | null> {
  const parts: readonly string[] = name.split(':');
  const groupId: string | undefined = parts[0];
  const artifactId: string | undefined = parts[1];
  if (groupId === undefined || artifactId === undefined) {
    return null;
  }
  for (const repository of repositories) {
    if (dead.has(repository.url)) {
      continue;
    }
    let response: HttpResponse;
    try {
      response = await fetchFn(metadataUrl(repository.url, groupId, artifactId), {
        headers: { ...repository.headers },
      });
    } catch {
      note('maven', `Could not reach ${repository.name}; it is skipped for the rest of this read`);
      dead.add(repository.url);
      continue;
    }
    if (!response.ok) {
      continue;
    }
    try {
      const versions: readonly string[] = parseMetadataVersions(await response.text());
      if (versions.length > 0) {
        return versions;
      }
    } catch {
      continue;
    }
  }
  return null;
}
