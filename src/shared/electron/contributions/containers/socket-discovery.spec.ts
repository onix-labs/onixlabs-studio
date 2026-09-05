import { createHash } from 'node:crypto';
import * as path from 'node:path';
import {
  DiscoveryEnvironment,
  EndpointDiscovery,
  endpointToPath,
  resolveEndpoint,
  ResolvedEndpoint,
} from './socket-discovery';

/**
 * The home directory the fake environment reports.
 */
const HOME: string = '/home/tester';

/**
 * Docker's discovery rules, as the catalogue declares them.
 */
const DOCKER: EndpointDiscovery = {
  hostVariable: 'DOCKER_HOST',
  dockerContext: true,
  defaults: (platform: NodeJS.Platform): readonly string[] =>
    platform === 'win32' ? ['\\\\.\\pipe\\docker_engine'] : ['/var/run/docker.sock'],
};

/**
 * Podman's discovery rules: its own variable, no docker context, rootless before rootful.
 */
const PODMAN: EndpointDiscovery = {
  hostVariable: 'CONTAINER_HOST',
  dockerContext: false,
  defaults: (): readonly string[] => [
    '/run/user/1000/podman/podman.sock',
    '/run/podman/podman.sock',
  ],
};

/**
 * Builds a fake discovery environment.
 * @param options The machine state to present: files that exist, file contents, environment
 * variables and the platform.
 * @returns Returns the environment.
 */
function environmentWith(options: {
  files?: Readonly<Record<string, string>>;
  sockets?: readonly string[];
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): DiscoveryEnvironment {
  const files: Readonly<Record<string, string>> = options.files ?? {};
  const sockets: ReadonlySet<string> = new Set<string>(options.sockets ?? []);
  return {
    platform: options.platform ?? 'darwin',
    env: options.env ?? {},
    home: HOME,
    exists: (target: string): boolean => sockets.has(target) || target in files,
    read: (target: string): string | null => files[target] ?? null,
  };
}

/**
 * Builds the file map for a docker context naming an endpoint, laid out the way the CLI lays it out.
 * @param name The context name.
 * @param host The endpoint the context names.
 * @param directory The Docker configuration directory, defaulting to the one under the home directory.
 * @returns Returns the file map.
 */
function contextFiles(
  name: string,
  host: string,
  directory: string = path.join(HOME, '.docker'),
): Readonly<Record<string, string>> {
  const hashed: string = createHash('sha256').update(name).digest('hex');
  return {
    [path.join(directory, 'config.json')]: JSON.stringify({ currentContext: name }),
    [path.join(directory, 'contexts', 'meta', hashed, 'meta.json')]: JSON.stringify({
      Name: name,
      Endpoints: { docker: { Host: host } },
    }),
  };
}

describe('endpointToPath', () => {
  it('stripsTheUnixScheme', () => {
    expect(endpointToPath('unix:///var/run/docker.sock')).toBe('/var/run/docker.sock');
  });

  it('turnsANamedPipeUrlIntoAPipePath', () => {
    expect(endpointToPath('npipe:////./pipe/docker_engine')).toBe('\\\\.\\pipe\\docker_engine');
  });

  it('honoursABarePathBecausePeopleWriteThemInDockerHost', () => {
    expect(endpointToPath('/var/run/docker.sock')).toBe('/var/run/docker.sock');
  });

  it('refusesEndpointsTheLocalSocketTransportCannotOpen', () => {
    // Real Docker set-ups, but not ones a Unix-socket client can reach; discovery must fall through
    // rather than hand a hostname to a socket connect.
    expect(endpointToPath('tcp://10.0.0.2:2375')).toBeNull();
    expect(endpointToPath('ssh://user@host')).toBeNull();
  });
});

describe('resolveEndpoint', () => {
  it('prefersTheEnvironmentVariableOverEverythingElse', () => {
    const endpoint: ResolvedEndpoint | null = resolveEndpoint(
      DOCKER,
      environmentWith({
        env: { DOCKER_HOST: 'unix:///tmp/from-env.sock' },
        files: contextFiles('desktop-linux', 'unix:///tmp/from-context.sock'),
        sockets: ['/tmp/from-env.sock', '/tmp/from-context.sock', '/var/run/docker.sock'],
      }),
    );

    expect(endpoint).toEqual({ path: '/tmp/from-env.sock', source: 'environment', exists: true });
  });

  it('prefersTheActiveDockerContextOverThePlatformDefault', () => {
    // The case that started #593: Docker Desktop's symlink at the default path exists, but the
    // context names the endpoint that is actually being served.
    const endpoint: ResolvedEndpoint | null = resolveEndpoint(
      DOCKER,
      environmentWith({
        files: contextFiles('colima', 'unix:///home/tester/.colima/default/docker.sock'),
        sockets: ['/home/tester/.colima/default/docker.sock', '/var/run/docker.sock'],
      }),
    );

    expect(endpoint?.path).toBe('/home/tester/.colima/default/docker.sock');
    expect(endpoint?.source).toBe('docker-context');
  });

  it('fallsBackToThePlatformDefaultWhenNothingNamesAnEndpoint', () => {
    const endpoint: ResolvedEndpoint | null = resolveEndpoint(
      DOCKER,
      environmentWith({ sockets: ['/var/run/docker.sock'] }),
    );

    expect(endpoint).toEqual({ path: '/var/run/docker.sock', source: 'default', exists: true });
  });

  it('skipsANamedEndpointThatIsNotThereAndTakesOneThatIs', () => {
    const endpoint: ResolvedEndpoint | null = resolveEndpoint(
      DOCKER,
      environmentWith({
        env: { DOCKER_HOST: 'unix:///tmp/stale.sock' },
        sockets: ['/var/run/docker.sock'],
      }),
    );

    expect(endpoint?.path).toBe('/var/run/docker.sock');
    expect(endpoint?.exists).toBe(true);
  });

  it('reportsTheHighestPrecedenceCandidateWhenNoneExists', () => {
    // "Podman is not running" is more useful than "there is no Podman", and needs a path to name.
    const endpoint: ResolvedEndpoint | null = resolveEndpoint(
      PODMAN,
      environmentWith({ env: { CONTAINER_HOST: 'unix:///tmp/podman.sock' } }),
    );

    expect(endpoint).toEqual({ path: '/tmp/podman.sock', source: 'environment', exists: false });
  });

  it('takesTheRootlessPodmanSocketBeforeTheRootfulOne', () => {
    const endpoint: ResolvedEndpoint | null = resolveEndpoint(
      PODMAN,
      environmentWith({
        sockets: ['/run/user/1000/podman/podman.sock', '/run/podman/podman.sock'],
      }),
    );

    expect(endpoint?.path).toBe('/run/user/1000/podman/podman.sock');
  });

  it('ignoresTheDockerContextForAnEngineThatDoesNotUseIt', () => {
    const endpoint: ResolvedEndpoint | null = resolveEndpoint(
      PODMAN,
      environmentWith({
        files: contextFiles('desktop-linux', 'unix:///tmp/docker.sock'),
        sockets: ['/tmp/docker.sock', '/run/podman/podman.sock'],
      }),
    );

    expect(endpoint?.path).toBe('/run/podman/podman.sock');
  });

  it('ignoresAContextNamingAnEndpointItCannotOpen', () => {
    const endpoint: ResolvedEndpoint | null = resolveEndpoint(
      DOCKER,
      environmentWith({
        files: contextFiles('remote', 'tcp://10.0.0.2:2375'),
        sockets: ['/var/run/docker.sock'],
      }),
    );

    expect(endpoint?.path).toBe('/var/run/docker.sock');
    expect(endpoint?.source).toBe('default');
  });

  it('ignoresTheContextNamedDefaultBecauseItMeansNoContext', () => {
    const endpoint: ResolvedEndpoint | null = resolveEndpoint(
      DOCKER,
      environmentWith({
        files: { [path.join(HOME, '.docker', 'config.json')]: '{"currentContext":"default"}' },
        sockets: ['/var/run/docker.sock'],
      }),
    );

    expect(endpoint?.source).toBe('default');
  });

  it('honoursDockerConfigWhenLocatingTheContextStore', () => {
    const endpoint: ResolvedEndpoint | null = resolveEndpoint(
      DOCKER,
      environmentWith({
        env: { DOCKER_CONFIG: '/etc/docker-config' },
        files: contextFiles('rancher-desktop', 'unix:///tmp/rd.sock', '/etc/docker-config'),
        sockets: ['/tmp/rd.sock', '/var/run/docker.sock'],
      }),
    );

    expect(endpoint?.path).toBe('/tmp/rd.sock');
  });

  it('survivesAMalformedDockerConfiguration', () => {
    const endpoint: ResolvedEndpoint | null = resolveEndpoint(
      DOCKER,
      environmentWith({
        files: { [path.join(HOME, '.docker', 'config.json')]: 'not json at all' },
        sockets: ['/var/run/docker.sock'],
      }),
    );

    expect(endpoint?.path).toBe('/var/run/docker.sock');
  });

  it('survivesAContextWhoseMetadataIsMissingOrMalformed', () => {
    const endpoint: ResolvedEndpoint | null = resolveEndpoint(
      DOCKER,
      environmentWith({
        files: { [path.join(HOME, '.docker', 'config.json')]: '{"currentContext":"ghost"}' },
        sockets: ['/var/run/docker.sock'],
      }),
    );

    expect(endpoint?.path).toBe('/var/run/docker.sock');
  });

  it('treatsAWindowsNamedPipeAsPresentBecauseItCannotBeStatted', () => {
    const endpoint: ResolvedEndpoint | null = resolveEndpoint(
      DOCKER,
      environmentWith({ platform: 'win32' }),
    );

    expect(endpoint).toEqual({
      path: '\\\\.\\pipe\\docker_engine',
      source: 'default',
      exists: true,
    });
  });

  it('reportsNothingForAnEngineWithNoCandidatesOnThisPlatform', () => {
    const nowhere: EndpointDiscovery = {
      hostVariable: 'NOWHERE_HOST',
      dockerContext: false,
      defaults: (): readonly string[] => [],
    };

    expect(resolveEndpoint(nowhere, environmentWith({}))).toBeNull();
  });
});
