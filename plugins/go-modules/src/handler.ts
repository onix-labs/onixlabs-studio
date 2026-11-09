import { addCommand, removeCommand, restoreCommand } from './commands';
import { GoModulesPackageManager } from './go-modules';
import {
  CredentialAsk,
  HttpFetch,
  PackageManagerCapability,
  PackageSearchOptions,
} from './protocol';

/**
 * The protocol version this plugin speaks: 1.1, for `searchExactName`.
 */
const PROTOCOL: string = '1.1';

/**
 * What this plugin can do. A module proxy has no search — it answers only for a path it is given, and
 * pkg.go.dev has no public API — so `search` is an exact-path lookup (`searchExactName`), and there is
 * no `prerelease`: the lookup answers with the version `go get @latest` would choose.
 */
const CAPABILITIES: readonly PackageManagerCapability[] = [
  'sources',
  'search',
  'searchExactName',
  'install',
  'update',
  'remove',
  'restore',
];

/**
 * A request as it arrives. Studio's host has already checked it, but the plugin still reads its
 * parameters as what they are: JSON from another process.
 */
export interface GoRequest {
  /**
   * Gets the correlation identifier.
   */
  readonly id: number;

  /**
   * Gets the operation.
   */
  readonly op: string;

  /**
   * Gets the absolute folder, absent only for the handshake.
   */
  readonly root?: string;

  /**
   * Gets the operation's parameters.
   */
  readonly params?: Record<string, unknown>;
}

/**
 * Describes the answer to a request.
 */
export type GoResponse =
  | { readonly id: number; readonly ok: true; readonly result: unknown }
  | { readonly id: number; readonly ok: false; readonly error: string };

/**
 * Reads a string parameter.
 * @param params The parameters.
 * @param name The parameter.
 * @returns Returns the value, or an empty string when it is not one.
 */
function text(params: Record<string, unknown> | undefined, name: string): string {
  const value: unknown = params?.[name];
  return typeof value === 'string' ? value : '';
}

/**
 * Reads the version of a write.
 * @param params The parameters.
 * @returns Returns the version, or null for the latest.
 */
function version(params: Record<string, unknown> | undefined): string | null {
  const value: unknown = params?.['version'];
  return typeof value === 'string' ? value : null;
}

/**
 * Answers the protocol's requests: the part of the plugin that is neither stdin and stdout nor Go.
 */
export class GoEndpointHandler {
  /**
   * Holds the Go model and lookup.
   */
  private readonly manager: GoModulesPackageManager;

  /**
   * Holds the fetch proxy requests go through.
   */
  private readonly fetchFn: HttpFetch;

  /**
   * Initializes the handler.
   * @param fetchFn The fetch proxy requests go through.
   * @param credential Asks Studio for a token saved for a proxy.
   * @param env The environment the Go settings are read from.
   */
  public constructor(
    fetchFn: HttpFetch,
    credential: CredentialAsk,
    env: Record<string, string | undefined>,
  ) {
    this.fetchFn = fetchFn;
    this.manager = new GoModulesPackageManager(credential, env);
  }

  /**
   * Answers one request. Never rejects: whatever goes wrong is a failed request.
   * @param request The request.
   * @returns Returns the answer.
   */
  public async handle(request: GoRequest): Promise<GoResponse> {
    try {
      return { id: request.id, ok: true, result: await this.answer(request) };
    } catch (error: unknown) {
      return {
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : 'The request failed.',
      };
    }
  }

  /**
   * Performs an operation.
   * @param request The request.
   * @returns Returns the result.
   * @throws When the operation is unknown, or a request needing a folder names none.
   */
  private async answer(request: GoRequest): Promise<unknown> {
    if (request.op === 'initialize') {
      return { protocol: PROTOCOL, capabilities: CAPABILITIES, toolVersion: null };
    }
    const root: string | undefined = request.root;
    if (root === undefined) {
      throw new Error(`${request.op} needs a folder.`);
    }
    const params: Record<string, unknown> | undefined = request.params;
    const project: string = text(params, 'project');
    const name: string = text(params, 'name');
    switch (request.op) {
      case 'load':
        return this.manager.load(root, this.fetchFn);
      case 'sources':
        return { sources: await this.manager.listSources() };
      case 'search':
        return this.manager.search(
          text(params, 'source'),
          text(params, 'query'),
          searchOptions(params),
          this.fetchFn,
        );
      case 'install':
        return addCommand(project, name, version(params), `Install ${name}`);
      case 'update':
        return addCommand(project, name, version(params), `Update ${name}`);
      case 'remove':
        return removeCommand(project, name);
      case 'restore':
        return restoreCommand(project);
      default:
        throw new Error(`${request.op} is not an operation this plugin knows.`);
    }
  }
}

/**
 * Reads a search's paging out of its parameters.
 * @param params The parameters.
 * @returns Returns the options.
 */
function searchOptions(params: Record<string, unknown> | undefined): PackageSearchOptions {
  const skip: unknown = params?.['skip'];
  const take: unknown = params?.['take'];
  return {
    skip: typeof skip === 'number' ? skip : 0,
    take: typeof take === 'number' ? take : 50,
    prerelease: false,
  };
}
