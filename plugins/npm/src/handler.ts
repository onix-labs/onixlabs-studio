import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { addCommand, NodeTool, removeCommand, restoreCommand, toolFor } from './commands';
import { note } from './log';
import { NpmPackageManager } from './npm';
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
 * What this plugin can do. The registry needs text and reports latest versions only, so
 * `searchRequiresQuery` is here and `prerelease` is not.
 */
const CAPABILITIES: readonly PackageManagerCapability[] = [
  'sources',
  'search',
  'searchRequiresQuery',
  'install',
  'update',
  'remove',
  'restore',
];

/**
 * A request as it arrives. Studio's host has already checked it, but the plugin still reads its
 * parameters as what they are: JSON from another process.
 */
export interface NpmRequest {
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
export type NpmResponse =
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
 * Answers the protocol's requests: the part of the plugin that is neither stdin and stdout nor npm.
 */
export class NpmEndpointHandler {
  /**
   * Holds the npm model and search.
   */
  private readonly manager: NpmPackageManager;

  /**
   * Holds the fetch registry requests go through.
   */
  private readonly fetchFn: HttpFetch;

  /**
   * Initializes the handler.
   * @param fetchFn The fetch registry requests go through.
   * @param credential Asks Studio for a token saved for a registry.
   * @param env The environment `.npmrc` references are resolved from.
   */
  public constructor(
    fetchFn: HttpFetch,
    credential: CredentialAsk,
    env: Record<string, string | undefined>,
  ) {
    this.fetchFn = fetchFn;
    this.manager = new NpmPackageManager(credential, env);
  }

  /**
   * Answers one request. Never rejects: whatever goes wrong is a failed request.
   * @param request The request.
   * @returns Returns the answer.
   */
  public async handle(request: NpmRequest): Promise<NpmResponse> {
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
  private async answer(request: NpmRequest): Promise<unknown> {
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
      case 'update':
        return this.addTo(root, params, request.op);
      case 'remove': {
        const project: string = text(params, 'project');
        return removeCommand(await this.toolOf(root, project), project, text(params, 'name'));
      }
      case 'restore': {
        const project: string = text(params, 'project');
        return restoreCommand(await this.toolOf(root, project), project);
      }
      default:
        throw new Error(`${request.op} is not an operation this plugin knows.`);
    }
  }

  /**
   * Builds the command for an install or an update.
   * @param root The folder.
   * @param params The request's parameters.
   * @param op Which of the two it is.
   * @returns Returns the command.
   */
  private async addTo(
    root: string,
    params: Record<string, unknown> | undefined,
    op: 'install' | 'update',
  ): Promise<unknown> {
    const project: string = text(params, 'project');
    const name: string = text(params, 'name');
    const version: unknown = params?.['version'];
    return addCommand(
      await this.toolOf(root, project),
      project,
      name,
      typeof version === 'string' ? version : null,
      `${op === 'install' ? 'Install' : 'Update'} ${name}`,
    );
  }

  /**
   * Finds the tool a project uses, from the lockfile beside it or at the folder's root: a workspace
   * keeps one lockfile at its top, and the package's own directory holds none.
   * @param root The folder.
   * @param project The absolute manifest path.
   * @returns Returns the tool.
   */
  private async toolOf(root: string, project: string): Promise<NodeTool> {
    const files: string[] = [];
    for (const directory of new Set<string>([path.dirname(project), root])) {
      try {
        files.push(...(await fs.readdir(directory)));
      } catch {
        note('npm', 'A project folder could not be read');
      }
    }
    return toolFor(files);
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
