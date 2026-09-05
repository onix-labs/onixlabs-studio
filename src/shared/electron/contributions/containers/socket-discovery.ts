import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { logger } from '../../logger';

// Finding the container engine's socket. This exists because the obvious answer is wrong: Studio used
// to look for `/var/run/docker.sock` and nothing else, and on macOS that path exists *only* because
// Docker Desktop writes a compatibility symlink to `~/.docker/run/docker.sock`. The endpoint the
// `docker` CLI actually uses is named by the active **context**, which is why Colima, OrbStack and
// Rancher Desktop were invisible to Studio no matter what was running (#593).
//
// The order below is the `docker` CLI's own: the environment variable wins, then the active context,
// then the platform default. Following it means Studio talks to whatever the user's own `docker`
// command talks to, which is the only definition of "the engine that is running" that will not
// surprise them.

/**
 * Describes how one engine's endpoint is found, as data rather than as code.
 *
 * Deliberately declarative: these are the fields a plugin manifest will carry when engines become a
 * contribution point (#594), so the shape is chosen now to be liftable then. Nothing here is a
 * function of anything but the platform and the environment.
 */
export interface EndpointDiscovery {
  /**
   * Gets the environment variable that names the endpoint outright, such as `DOCKER_HOST`. Highest
   * precedence, because a user who sets it is telling every tool on the machine where to look.
   */
  readonly hostVariable: string;

  /**
   * Gets whether the `docker` CLI's context store names this engine's endpoint.
   *
   * True for Docker, and true in a way that is more useful than it first appears: the active context
   * is how Colima, OrbStack and Rancher Desktop publish their sockets, so honouring it makes all of
   * them reachable through the Docker entry without Studio knowing they exist. Podman keeps its own
   * configuration and sets this false.
   */
  readonly dockerContext: boolean;

  /**
   * Gets the fallback endpoints for a platform, nearest first, used when nothing names one.
   * @param platform The platform to resolve for.
   * @returns Returns the candidate paths, or an empty list when the engine does not run here.
   */
  defaults(platform: NodeJS.Platform): readonly string[];
}

/**
 * Where an endpoint came from, kept so the resolution can be explained in a log line rather than
 * inferred from behaviour.
 */
export type EndpointSource = 'environment' | 'docker-context' | 'default';

/**
 * The outcome of resolving an engine's endpoint.
 */
export interface ResolvedEndpoint {
  /**
   * Gets the socket path (a Unix domain socket path, or a Windows named pipe).
   */
  readonly path: string;

  /**
   * Gets where the path came from.
   */
  readonly source: EndpointSource;

  /**
   * Gets whether the socket is actually there. False means the engine is known but not running, which
   * is a state the surface reports rather than an error.
   */
  readonly exists: boolean;
}

/**
 * The environment discovery reads: the platform, the process environment, and the file system. Injected
 * as a whole so the rules can be unit-tested without touching a real machine, and so a test never
 * depends on what happens to be installed on the one it runs on.
 */
export interface DiscoveryEnvironment {
  /**
   * Gets the platform to resolve for.
   */
  readonly platform: NodeJS.Platform;

  /**
   * Gets the process environment.
   */
  readonly env: NodeJS.ProcessEnv;

  /**
   * Gets the user's home directory, used to locate the Docker configuration directory.
   */
  readonly home: string;

  /**
   * Determines whether a path exists.
   * @param target The path to test.
   * @returns Returns true when the path exists.
   */
  exists(target: string): boolean;

  /**
   * Reads a file as UTF-8.
   * @param target The path to read.
   * @returns Returns the contents, or null when the file is absent or unreadable.
   */
  read(target: string): string | null;
}

/**
 * Builds the discovery environment from the running process.
 * @returns Returns the environment.
 */
export function processDiscoveryEnvironment(): DiscoveryEnvironment {
  return {
    platform: process.platform,
    env: process.env,
    home: homedir(),
    exists: (target: string): boolean => existsSync(target),
    read: (target: string): string | null => {
      try {
        return readFileSync(target, 'utf8');
      } catch {
        // Absent or unreadable are the same answer here: nothing to learn from this file.
        return null;
      }
    },
  };
}

/**
 * Converts an endpoint URL into a path the socket layer can open, or null when it names something this
 * transport cannot speak to.
 *
 * Only `unix://` and `npipe://` are accepted. A context may legitimately name a `tcp://` or `ssh://`
 * endpoint — a remote engine, or one reached through a jump host — and those are real Docker set-ups,
 * but the transport connects to a local socket. Returning null lets discovery fall through to the next
 * candidate rather than handing a hostname to a socket connect and failing obscurely.
 * @param endpoint The endpoint URL.
 * @returns Returns the socket path, or null when the scheme is not a local socket.
 */
export function endpointToPath(endpoint: string): string | null {
  const trimmed: string = endpoint.trim();
  if (trimmed.startsWith('unix://')) {
    return trimmed.slice('unix://'.length);
  }
  if (trimmed.startsWith('npipe://')) {
    // Named pipes are written with forward slashes in a URL and backslashes everywhere else.
    return trimmed.slice('npipe://'.length).replace(/\//g, '\\');
  }
  // A bare path is not a URL, but `DOCKER_HOST=/var/run/docker.sock` is a thing people write and it is
  // unambiguous, so it is honoured rather than rejected on a technicality.
  if (trimmed.startsWith('/') || trimmed.startsWith('\\\\')) {
    return trimmed;
  }
  return null;
}

/**
 * Gets the Docker configuration directory, honouring `DOCKER_CONFIG` as the CLI does.
 * @param environment The discovery environment.
 * @returns Returns the configuration directory.
 */
function dockerConfigDirectory(environment: DiscoveryEnvironment): string {
  const configured: string | undefined = environment.env['DOCKER_CONFIG'];
  return configured !== undefined && configured.length > 0
    ? configured
    : path.join(environment.home, '.docker');
}

/**
 * Reads the endpoint named by the active `docker` context, or null when there is none.
 *
 * The store is not documented as API, so this is written to fail quietly at every step: no config, no
 * current context, no metadata file, malformed JSON and a context naming a non-local endpoint all mean
 * "nothing to learn here", and resolution moves on to the platform default.
 *
 * The directory holding a context's metadata is named by the SHA-256 of the context name — verified
 * against a real Docker Desktop install, but a CLI implementation detail rather than a documented one.
 * A miss therefore means "no context endpoint" and resolution continues, rather than erroring.
 * @param environment The discovery environment.
 * @returns Returns the socket path named by the active context, or null.
 */
export function dockerContextEndpoint(environment: DiscoveryEnvironment): string | null {
  const directory: string = dockerConfigDirectory(environment);
  const config: string | null = environment.read(path.join(directory, 'config.json'));
  if (config === null) {
    return null;
  }
  let current: unknown;
  try {
    current = (JSON.parse(config) as { currentContext?: unknown }).currentContext;
  } catch {
    return null;
  }
  if (typeof current !== 'string' || current.length === 0 || current === 'default') {
    // `default` is the CLI's name for "no context, use the environment or the platform default",
    // which is exactly what the rest of resolution does anyway.
    return null;
  }
  const hashed: string = createHash('sha256').update(current).digest('hex');
  const meta: string | null = environment.read(
    path.join(directory, 'contexts', 'meta', hashed, 'meta.json'),
  );
  return meta === null ? null : hostFromContextMetadata(meta);
}

/**
 * Extracts the Docker endpoint from a context metadata document.
 * @param document The metadata JSON.
 * @returns Returns the socket path, or null when the document names no local Docker endpoint.
 */
function hostFromContextMetadata(document: string): string | null {
  try {
    const parsed: unknown = JSON.parse(document);
    const host: unknown = (parsed as { Endpoints?: { docker?: { Host?: unknown } } }).Endpoints
      ?.docker?.Host;
    return typeof host === 'string' ? endpointToPath(host) : null;
  } catch {
    return null;
  }
}

/**
 * Resolves an engine's endpoint: the environment variable, then the active `docker` context, then the
 * platform defaults, and among those the first that is actually there.
 *
 * When nothing exists, the highest-precedence *named* endpoint is returned with `exists` false rather
 * than nothing at all, because "Podman is not running" is a more useful thing for the surface to say
 * than "there is no Podman", and it needs a path to have reached that conclusion.
 * @param discovery How this engine's endpoint is found.
 * @param environment The discovery environment.
 * @returns Returns the resolved endpoint, or null when the engine does not run on this platform.
 */
export function resolveEndpoint(
  discovery: EndpointDiscovery,
  environment: DiscoveryEnvironment,
): ResolvedEndpoint | null {
  const candidates: { path: string; source: EndpointSource }[] = [];

  const named: string | undefined = environment.env[discovery.hostVariable];
  if (named !== undefined && named.length > 0) {
    const fromEnvironment: string | null = endpointToPath(named);
    if (fromEnvironment !== null) {
      candidates.push({ path: fromEnvironment, source: 'environment' });
    }
  }

  if (discovery.dockerContext) {
    const fromContext: string | null = dockerContextEndpoint(environment);
    if (fromContext !== null) {
      candidates.push({ path: fromContext, source: 'docker-context' });
    }
  }

  for (const fallback of discovery.defaults(environment.platform)) {
    candidates.push({ path: fallback, source: 'default' });
  }

  if (candidates.length === 0) {
    return null;
  }

  // Windows named pipes do not appear on the file system the way sockets do, so there the first
  // candidate is taken and the connection attempt is what reports the truth.
  if (environment.platform === 'win32') {
    return { ...candidates[0], exists: true };
  }

  const live: { path: string; source: EndpointSource } | undefined = candidates.find(
    (candidate: { path: string; source: EndpointSource }): boolean =>
      environment.exists(candidate.path),
  );
  return live !== undefined ? { ...live, exists: true } : { ...candidates[0], exists: false };
}

/**
 * Holds the last endpoint logged per engine, so the resolution is reported when it changes rather than
 * on every poll. Discovery runs whenever the renderer asks which engines are present, which is often
 * enough that logging each one would drown the log it is meant to help with.
 */
const reported: Map<string, string> = new Map<string, string>();

/**
 * Logs an engine's resolved endpoint the first time it is seen, and again whenever it changes.
 * @param engineId The engine the endpoint belongs to.
 * @param endpoint The resolved endpoint, or null when the engine does not run here.
 */
export function reportEndpoint(engineId: string, endpoint: ResolvedEndpoint | null): void {
  const description: string =
    endpoint === null
      ? 'not supported on this platform'
      : `${endpoint.path} (from ${endpoint.source}, ${endpoint.exists ? 'present' : 'absent'})`;
  if (reported.get(engineId) !== description) {
    reported.set(engineId, description);
    logger.info('ContainerEngine', `Endpoint for '${engineId}': ${description}`);
  }
}
