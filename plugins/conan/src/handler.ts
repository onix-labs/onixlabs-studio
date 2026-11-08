import { installCommand } from './commands';
import { ConanPackageManager } from './conan';
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
 * What this plugin can do. A remote's search needs a pattern, so `searchRequiresQuery` is here; it
 * reports versions, not a prerelease filter, so `prerelease` is not. Conan has no command to add,
 * update or remove a requirement, so only `restore` is offered among the writes.
 */
const CAPABILITIES: readonly PackageManagerCapability[] = [
  'sources',
  'search',
  'searchRequiresQuery',
  'restore',
];

/**
 * A request as it arrives. Studio's host has already checked it, but the plugin still reads its
 * parameters as what they are: JSON from another process.
 */
export interface ConanRequest {
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
export type ConanResponse =
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
 * Reads a search's paging out of its parameters.
 * @param params The parameters.
 * @returns Returns the options.
 */
function searchOptions(params: Record<string, unknown> | undefined): PackageSearchOptions {
  const skip: unknown = params?.['skip'];
  const take: unknown = params?.['take'];
  return {
    skip: typeof skip === 'number' && skip > 0 ? Math.floor(skip) : 0,
    take: typeof take === 'number' && take > 0 ? Math.floor(take) : 50,
    prerelease: false,
  };
}

/**
 * Answers the protocol's requests: the part of the plugin that is neither stdin and stdout nor Conan.
 */
export class ConanEndpointHandler {
  /**
   * Holds the Conan model and search.
   */
  private readonly manager: ConanPackageManager;

  /**
   * Initializes the handler.
   * @param fetchFn The fetch remote requests go through.
   * @param credential Asks Studio for a token saved for a remote.
   * @param env The environment the Conan home is found from.
   */
  public constructor(
    fetchFn: HttpFetch,
    credential: CredentialAsk,
    env: Record<string, string | undefined>,
  ) {
    this.manager = new ConanPackageManager(fetchFn, credential, env);
  }

  /**
   * Answers one request. Never rejects: whatever goes wrong is a failed request.
   * @param request The request.
   * @returns Returns the answer.
   */
  public async handle(request: ConanRequest): Promise<ConanResponse> {
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
   * @throws When the operation is unknown or not one Conan has, or a request needing a folder names
   * none.
   */
  private async answer(request: ConanRequest): Promise<unknown> {
    if (request.op === 'initialize') {
      return { protocol: PROTOCOL, capabilities: CAPABILITIES, toolVersion: null };
    }
    const root: string | undefined = request.root;
    if (root === undefined) {
      throw new Error(`${request.op} needs a folder.`);
    }
    const params: Record<string, unknown> | undefined = request.params;
    switch (request.op) {
      case 'load':
        return this.manager.load(root);
      case 'sources':
        return { sources: await this.manager.listSources() };
      case 'search':
        return this.manager.search(
          text(params, 'source'),
          text(params, 'query'),
          searchOptions(params),
        );
      case 'restore':
        return installCommand(text(params, 'project'));
      case 'install':
      case 'update':
      case 'remove':
        throw new Error(
          'Conan has no command to add, change or remove a requirement: edit the conanfile, then install.',
        );
      default:
        throw new Error(`${request.op} is not an operation this plugin knows.`);
    }
  }
}
