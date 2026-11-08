import { JvmPackageManager } from './jvm';
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
 * What this plugin can do. Maven Central's search needs text, so `searchRequiresQuery` is here; its
 * index reports one latest version per artifact with no prerelease filter, so `prerelease` is not.
 * Neither Maven nor Gradle can add, move or remove a dependency from the command line, so `restore` is
 * the only write.
 */
const CAPABILITIES: readonly PackageManagerCapability[] = [
  'sources',
  'search',
  'searchRequiresQuery',
  'restore',
];

/**
 * What the panel is told when it asks for a write neither tool has.
 */
const NO_EDITING_COMMAND: string =
  'Maven and Gradle have no command that changes a dependency: edit the pom.xml or build script, or the version catalog, and then resolve.';

/**
 * A request as it arrives. Studio's host has already checked it, but the plugin still reads its
 * parameters as what they are: JSON from another process.
 */
export interface MavenRequest {
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
export type MavenResponse =
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
    skip: typeof skip === 'number' ? skip : 0,
    take: typeof take === 'number' ? take : 50,
    prerelease: false,
  };
}

/**
 * Answers the protocol's requests: the part of the plugin that is neither stdin and stdout nor Maven.
 */
export class MavenEndpointHandler {
  /**
   * Holds the JVM model and search.
   */
  private readonly manager: JvmPackageManager;

  /**
   * Holds the fetch repository and search requests go through.
   */
  private readonly fetchFn: HttpFetch;

  /**
   * Initializes the handler.
   * @param fetchFn The fetch repository and search requests go through.
   * @param credential Asks Studio for a token saved for a repository.
   * @param searchBase The address of Maven Central's search, when it is not the real one.
   */
  public constructor(fetchFn: HttpFetch, credential: CredentialAsk, searchBase?: string) {
    this.fetchFn = fetchFn;
    this.manager = new JvmPackageManager(credential, searchBase);
  }

  /**
   * Answers one request. Never rejects: whatever goes wrong is a failed request.
   * @param request The request.
   * @returns Returns the answer.
   */
  public async handle(request: MavenRequest): Promise<MavenResponse> {
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
   * @throws When the operation is unknown, is a write neither tool has, or needs a folder and names
   * none.
   */
  private async answer(request: MavenRequest): Promise<unknown> {
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
        return this.manager.load(root, this.fetchFn);
      case 'sources':
        return { sources: this.manager.listSources() };
      case 'search':
        return this.manager.search(
          text(params, 'source'),
          text(params, 'query'),
          searchOptions(params),
          this.fetchFn,
        );
      case 'restore':
        return this.manager.restore(root, text(params, 'project'));
      case 'install':
      case 'update':
      case 'remove':
        throw new Error(NO_EDITING_COMMAND);
      default:
        throw new Error(`${request.op} is not an operation this plugin knows.`);
    }
  }
}
