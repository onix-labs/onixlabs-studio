import * as path from 'node:path';
import { addCommand, CommandTarget, removeCommand, restoreCommand } from './commands';
import { Placement } from './manifests';
import { PypiPackageManager, PythonProject, ScopedPackage } from './pypi';
import {
  CredentialAsk,
  HttpFetch,
  PackageManagerCapability,
  PackageSearchOptions,
} from './protocol';
import { normaliseName } from './requirements';

/**
 * The protocol version this plugin speaks: 1.1, for `searchExactName`.
 */
const PROTOCOL: string = '1.1';

/**
 * What this plugin can do. PyPI has no search, so a query is looked up as one exact name
 * (`searchExactName`), and no `prerelease` filter is offered. The writes are advertised because uv,
 * Poetry and Pipenv projects take them all; a project whose tool cannot (a requirements file, or one
 * nothing says the tool of) answers a write with the reason instead.
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
export interface PypiRequest {
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
export type PypiResponse =
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
 * Answers the protocol's requests: the part of the plugin that is neither stdin and stdout nor Python.
 */
export class PypiEndpointHandler {
  /**
   * Holds the Python model and lookups.
   */
  private readonly manager: PypiPackageManager;

  /**
   * Holds the fetch index requests go through.
   */
  private readonly fetchFn: HttpFetch;

  /**
   * Initializes the handler.
   * @param fetchFn The fetch index requests go through.
   * @param credential Asks Studio for a token saved for an index.
   * @param env The plugin's environment, where `PIP_INDEX_URL` and `PIP_CONFIG_FILE` are read from.
   */
  public constructor(
    fetchFn: HttpFetch,
    credential: CredentialAsk,
    env: Readonly<Record<string, string | undefined>>,
  ) {
    this.fetchFn = fetchFn;
    this.manager = new PypiPackageManager(credential, env);
  }

  /**
   * Answers one request. Never rejects: whatever goes wrong is a failed request.
   * @param request The request.
   * @returns Returns the answer.
   */
  public async handle(request: PypiRequest): Promise<PypiResponse> {
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
  private async answer(request: PypiRequest): Promise<unknown> {
    if (request.op === 'initialize') {
      return { protocol: PROTOCOL, capabilities: CAPABILITIES, toolVersion: null };
    }
    const root: string | undefined = request.root;
    if (root === undefined || !path.isAbsolute(root)) {
      throw new Error(`${request.op} needs a folder.`);
    }
    const params: Record<string, unknown> | undefined = request.params;
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
      case 'update':
        return this.addTo(root, params, request.op === 'update');
      case 'remove': {
        const project: PythonProject = await this.projectOf(root, params);
        const name: string = text(params, 'name');
        return removeCommand(
          targetOf(project),
          name,
          placementOf(project, name) ?? { kind: 'main' },
        );
      }
      case 'restore':
        return restoreCommand(targetOf(await this.projectOf(root, params)));
      default:
        throw new Error(`${request.op} is not an operation this plugin knows.`);
    }
  }

  /**
   * Builds the command for an install or an update. An update keeps the package where the manifest
   * declares it; an install adds a new one to the project's own dependencies.
   * @param root The folder.
   * @param params The request's parameters.
   * @param update Whether it is an update.
   * @returns Returns the command.
   */
  private async addTo(
    root: string,
    params: Record<string, unknown> | undefined,
    update: boolean,
  ): Promise<unknown> {
    const project: PythonProject = await this.projectOf(root, params);
    const name: string = text(params, 'name');
    const version: unknown = params?.['version'];
    const placement: Placement = (update ? placementOf(project, name) : null) ?? { kind: 'main' };
    return addCommand(
      targetOf(project),
      name,
      typeof version === 'string' ? version : null,
      placement,
      update,
    );
  }

  /**
   * Reads the project a write names.
   * @param root The folder.
   * @param params The request's parameters.
   * @returns Returns the project.
   * @throws When the path is not a manifest within the folder that this plugin reads.
   */
  private async projectOf(
    root: string,
    params: Record<string, unknown> | undefined,
  ): Promise<PythonProject> {
    const manifest: string = text(params, 'project');
    const resolved: string = path.resolve(manifest);
    const inside: boolean =
      path.isAbsolute(manifest) && resolved.startsWith(path.resolve(root) + path.sep);
    const project: PythonProject | null = inside
      ? await this.manager.projectAt(path.resolve(root), resolved)
      : null;
    if (project === null) {
      throw new Error('That is not a Python project in this folder.');
    }
    return project;
  }
}

/**
 * Reads what a command needs to know of a project.
 * @param project The project.
 * @returns Returns the target.
 */
function targetOf(project: PythonProject): CommandTarget {
  return {
    manifestPath: project.manifestPath,
    tool: project.tool,
    locked: project.lockfile !== null,
    venv: project.venv,
  };
}

/**
 * Finds where a project declares a package.
 * @param project The project.
 * @param name The package name.
 * @returns Returns the place, or null when it does not declare it.
 */
function placementOf(project: PythonProject, name: string): Placement | null {
  const key: string = normaliseName(name);
  return (
    project.declared.find(
      (declared: ScopedPackage): boolean => normaliseName(declared.name) === key,
    )?.placement ?? null
  );
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
