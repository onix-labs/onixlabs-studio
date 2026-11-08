import { addPortCommand, installCommand } from './commands';
import { PackageManagerCapability, PackageSearchOptions } from './protocol';
import { BaselineStore } from './registry';
import { VcpkgPackageManager } from './vcpkg';

/**
 * The protocol version this plugin speaks.
 */
const PROTOCOL: string = '1.0';

/**
 * What this plugin can do. The port list is local once fetched, so an empty query browses it and
 * `searchRequiresQuery` is not here; the registry has no prerelease versions, so `prerelease` is not
 * either. vcpkg has no command to remove a dependency or change its version, so `remove` and `update`
 * are not offered.
 */
const CAPABILITIES: readonly PackageManagerCapability[] = [
  'sources',
  'search',
  'install',
  'restore',
];

/**
 * A request as it arrives. Studio's host has already checked it, but the plugin still reads its
 * parameters as what they are: JSON from another process.
 */
export interface VcpkgRequest {
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
export type VcpkgResponse =
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
 * Answers the protocol's requests: the part of the plugin that is neither stdin and stdout nor vcpkg.
 */
export class VcpkgEndpointHandler {
  /**
   * Holds the vcpkg model and search.
   */
  private readonly manager: VcpkgPackageManager;

  /**
   * Initializes the handler.
   * @param baselines The built-in registry's baselines.
   */
  public constructor(baselines: BaselineStore) {
    this.manager = new VcpkgPackageManager(baselines);
  }

  /**
   * Answers one request. Never rejects: whatever goes wrong is a failed request.
   * @param request The request.
   * @returns Returns the answer.
   */
  public async handle(request: VcpkgRequest): Promise<VcpkgResponse> {
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
   * @throws When the operation is unknown or not one vcpkg has, or a request needing a folder names
   * none.
   */
  private async answer(request: VcpkgRequest): Promise<unknown> {
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
        return { sources: this.manager.listSources() };
      case 'search':
        return this.manager.search(
          text(params, 'source'),
          text(params, 'query'),
          searchOptions(params),
        );
      case 'install': {
        const version: unknown = params?.['version'];
        return addPortCommand(
          text(params, 'project'),
          text(params, 'name'),
          typeof version === 'string' ? version : null,
        );
      }
      case 'restore':
        return installCommand(text(params, 'project'));
      case 'update':
        throw new Error(
          'vcpkg has no command to change the version of a dependency: add an override to vcpkg.json, or move its builtin-baseline.',
        );
      case 'remove':
        throw new Error('vcpkg has no command to remove a dependency: delete it from vcpkg.json.');
      default:
        throw new Error(`${request.op} is not an operation this plugin knows.`);
    }
  }
}
