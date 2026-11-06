import { addCommand, removeCommand, restoreCommand } from './commands';
import { NuGetPackageManager } from './nuget';
import {
  CredentialAsk,
  HttpFetch,
  PackageManagerCapability,
  PackageSearchOptions,
} from './protocol';

/**
 * The protocol version this plugin speaks.
 */
const PROTOCOL: string = '1.0';

/**
 * What this plugin can do. NuGet lists its packages with no query, so `searchRequiresQuery` is not here,
 * and its search takes a prerelease filter, so `prerelease` is.
 */
const CAPABILITIES: readonly PackageManagerCapability[] = [
  'sources',
  'search',
  'prerelease',
  'install',
  'update',
  'remove',
  'restore',
];

/**
 * A request as it arrives. Studio's host has already checked it, but the plugin still reads its
 * parameters as what they are: JSON from another process.
 */
export interface NuGetRequest {
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
export type NuGetResponse =
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
 * Answers the protocol's requests: the part of the plugin that is neither stdin and stdout nor NuGet.
 */
export class NuGetEndpointHandler {
  /**
   * Holds the NuGet model and search.
   */
  private readonly manager: NuGetPackageManager;

  /**
   * Holds the fetch feed requests go through.
   */
  private readonly fetchFn: HttpFetch;

  /**
   * Initializes the handler.
   * @param fetchFn The fetch feed requests go through.
   * @param credential Asks Studio for a token saved for a feed.
   * @param env The environment `nuget.config` references are resolved from.
   */
  public constructor(
    fetchFn: HttpFetch,
    credential: CredentialAsk,
    env: Record<string, string | undefined>,
  ) {
    this.fetchFn = fetchFn;
    this.manager = new NuGetPackageManager(credential, env);
  }

  /**
   * Answers one request. Never rejects: whatever goes wrong is a failed request.
   * @param request The request.
   * @returns Returns the answer.
   */
  public async handle(request: NuGetRequest): Promise<NuGetResponse> {
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
  private async answer(request: NuGetRequest): Promise<unknown> {
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
        return { sources: await this.manager.listSources(root) };
      case 'search':
        return this.manager.search(
          root,
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
 * Reads a search's paging and filter out of its parameters.
 * @param params The parameters.
 * @returns Returns the options.
 */
function searchOptions(params: Record<string, unknown> | undefined): PackageSearchOptions {
  const skip: unknown = params?.['skip'];
  const take: unknown = params?.['take'];
  return {
    skip: typeof skip === 'number' ? skip : 0,
    take: typeof take === 'number' ? take : 50,
    prerelease: params?.['prerelease'] === true,
  };
}
