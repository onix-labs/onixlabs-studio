import { DestroyRef, inject, Service } from '@angular/core';
import { AiRuntime } from '@shared/angular/services/ai-runtime/ai-runtime';
import { Log } from '@shared/angular/services/log/log';
import {
  CREATE_API_REQUEST,
  LIST_API_REQUESTS,
  SEND_API_REQUEST,
  SET_API_VARIABLE,
  UPDATE_API_REQUEST,
} from '@shared/api/ai-types';
import {
  ApiEnvironment,
  ApiFolder,
  ApiRequest,
  HttpBody,
  HttpBodyKind,
  HttpField,
  HttpMethod,
  HttpOutcome,
} from '@shared/api/api-client-types';
import { ApiRequestOpener } from '../api-request-opener/api-request-opener';
import { ApiWorkspace, newField } from '../api-workspace/api-workspace';

/**
 * How much of a response body is handed back to the agent. A large payload would otherwise consume
 * the context window the model needs in order to reason about it; the user has the whole thing in the
 * response pane either way.
 */
const MAX_AGENT_BODY_CHARS: number = 8_000;

/**
 * The result of the list capability.
 */
interface ListResult {
  /**
   * Gets whether an API Explorer tab was open to read from.
   */
  readonly available: boolean;

  /**
   * Gets the collections, each with its requests.
   */
  readonly collections: readonly unknown[];

  /**
   * Gets the environments and their variables, with the active one marked.
   */
  readonly environments: readonly unknown[];
}

/**
 * The result of a mutating capability.
 */
interface WriteResult {
  /**
   * Gets whether the write was applied.
   */
  readonly ok: boolean;

  /**
   * Gets the reason the write was refused, when it was.
   */
  readonly error?: string;

  /**
   * Gets the id of the affected request.
   */
  readonly id?: string;

  /**
   * Gets the name of the affected request or environment.
   */
  readonly name?: string;

  /**
   * Gets the name of the environment a variable was set in.
   */
  readonly environment?: string;
}

/**
 * The result of the send capability.
 */
interface SendResult {
  /**
   * Gets whether a response was obtained.
   */
  readonly ok: boolean;

  /**
   * Gets why no response was obtained, when none was.
   */
  readonly error?: string;

  /**
   * Gets the HTTP status code.
   */
  readonly status?: number;

  /**
   * Gets the HTTP status text.
   */
  readonly statusText?: string;

  /**
   * Gets how long the send took, in milliseconds.
   */
  readonly durationMs?: number;

  /**
   * Gets the response headers.
   */
  readonly headers?: Readonly<Record<string, string>>;

  /**
   * Gets the response body, truncated to {@link MAX_AGENT_BODY_CHARS}.
   */
  readonly body?: string;

  /**
   * Gets whether the body was truncated.
   */
  readonly truncated?: boolean;
}

/**
 * Registers the API Explorer's agent capabilities with the {@link AiRuntime} registry: listing the
 * collections, creating and changing saved requests, sending one, and setting an environment
 * variable. The main-process providers invoke these by name over the renderer bridge, which is what
 * turns "explain this endpoint" into a request the user can actually press Send on.
 *
 * They are registered *here*, in the renderer, rather than performed in the main process, for the same
 * reason the run-configuration capabilities are: a write goes through the same {@link ApiWorkspace}
 * the panels read, so the tree, the well and the status strip update the moment the agent acts, with
 * no reload and no race. The agent creates a request through exactly the API a user's click does.
 *
 * Provided by the API Explorer view, so the capabilities exist only while such a tab is open and are
 * released with it.
 */
@Service()
export class ApiAgentCapabilities {
  /**
   * Holds the agent runtime the capabilities are registered with.
   */
  private readonly runtime: AiRuntime = inject(AiRuntime);

  /**
   * Holds the API workspace the capabilities read and write.
   */
  private readonly workspace: ApiWorkspace = inject(ApiWorkspace);

  /**
   * Holds the opener, so a created request is shown rather than merely saved.
   */
  private readonly opener: ApiRequestOpener = inject(ApiRequestOpener);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Registers the capabilities and releases them when the owning view is destroyed. Releasing matters:
   * the registry is application-wide, and a stale handler would write into the workspace of a closed
   * tab.
   */
  public constructor() {
    const releases: readonly (() => void)[] = [
      this.runtime.registerCapability(LIST_API_REQUESTS, (): ListResult => this.list()),
      this.runtime.registerCapability(
        CREATE_API_REQUEST,
        (input: unknown): WriteResult => this.create(input),
      ),
      this.runtime.registerCapability(
        UPDATE_API_REQUEST,
        (input: unknown): WriteResult => this.update(input),
      ),
      this.runtime.registerCapability(
        SEND_API_REQUEST,
        (input: unknown): Promise<SendResult> => this.send(input),
      ),
      this.runtime.registerCapability(
        SET_API_VARIABLE,
        (input: unknown): WriteResult => this.setVariable(input),
      ),
    ];
    inject(DestroyRef).onDestroy((): void => {
      for (const release of releases) {
        release();
      }
    });
    this.log.info('api-explorer.agent', 'API agent capabilities registered');
  }

  /**
   * Lists the collections, their requests, and the environments.
   * @returns Returns the {@link ListResult}.
   */
  private list(): ListResult {
    const activeId: string | null = this.workspace.activeEnvironmentId();
    return {
      available: true,
      collections: this.workspace
        .folders()
        .filter((folder: ApiFolder): boolean => folder.parentId === null)
        .map((folder: ApiFolder): unknown => ({
          id: folder.id,
          name: folder.name,
          requests: this.workspace
            .requests()
            .filter((request: ApiRequest): boolean => request.parentId === folder.id)
            .map((request: ApiRequest): unknown => ({
              id: request.id,
              name: request.name,
              method: request.method,
              url: request.url,
              description: request.description,
            })),
        })),
      environments: this.workspace.environments().map((environment: ApiEnvironment): unknown => ({
        id: environment.id,
        name: environment.name,
        active: environment.id === activeId,
        variables: environment.variables
          .filter((variable: HttpField): boolean => variable.enabled)
          .map((variable: HttpField): unknown => ({
            name: variable.name,
            value: variable.value,
          })),
      })),
    };
  }

  /**
   * Creates a saved request and opens it in the well.
   * @param input The tool's arguments.
   * @returns Returns the {@link WriteResult}.
   */
  private create(input: unknown): WriteResult {
    const args: Record<string, unknown> = (input ?? {}) as Record<string, unknown>;
    const name: string = this.text(args['name']).trim();
    const url: string = this.text(args['url']).trim();
    if (name === '' || url === '') {
      return { ok: false, error: 'A request needs both a name and a URL.' };
    }
    const parent: ApiFolder = this.resolveCollection(args['collection']);
    const request: ApiRequest = this.workspace.addRequest(parent.id, {
      name,
      url,
      method: (args['method'] as HttpMethod | undefined) ?? 'GET',
      description: this.text(args['description']),
      headers: this.toFields(args['headers']),
      params: this.toFields(args['params']),
      body: this.toBody(args['body'], args['body_kind']),
    });
    this.opener.open(request.id);
    this.log.info('api-explorer.agent', 'Agent created a request', {
      id: request.id,
      method: request.method,
    });
    return { ok: true, id: request.id, name: request.name };
  }

  /**
   * Applies changes to a saved request.
   * @param input The tool's arguments.
   * @returns Returns the {@link WriteResult}.
   */
  private update(input: unknown): WriteResult {
    const args: Record<string, unknown> = (input ?? {}) as Record<string, unknown>;
    const id: string = this.text(args['id']);
    const existing: ApiRequest | undefined = this.workspace.request(id);
    if (existing === undefined) {
      return { ok: false, error: `No saved request has the id ${id}.` };
    }
    const changes: Partial<ApiRequest> = {
      ...(args['name'] === undefined ? {} : { name: this.text(args['name']) }),
      ...(args['url'] === undefined ? {} : { url: this.text(args['url']) }),
      ...(args['method'] === undefined ? {} : { method: args['method'] as HttpMethod }),
      ...(args['description'] === undefined
        ? {}
        : { description: this.text(args['description']) }),
      ...(args['headers'] === undefined ? {} : { headers: this.toFields(args['headers']) }),
      ...(args['params'] === undefined ? {} : { params: this.toFields(args['params']) }),
      ...(args['body'] === undefined && args['body_kind'] === undefined
        ? {}
        : { body: this.toBody(args['body'] ?? existing.body.text, args['body_kind']) }),
    };
    this.workspace.updateRequest(id, changes);
    if (changes.name !== undefined) {
      this.opener.retitle(id, changes.name);
    }
    this.log.info('api-explorer.agent', 'Agent updated a request', { id });
    return { ok: true, id, name: changes.name ?? existing.name };
  }

  /**
   * Sends a saved request and renders its outcome for the agent.
   * @param input The tool's arguments.
   * @returns Returns the {@link SendResult}.
   */
  private async send(input: unknown): Promise<SendResult> {
    const args: Record<string, unknown> = (input ?? {}) as Record<string, unknown>;
    const id: string = this.text(args['id']);
    if (this.workspace.request(id) === undefined) {
      return { ok: false, error: `No saved request has the id ${id}.` };
    }
    // The send goes through the workspace, so the agent's call lands in the response pane, the
    // history and the status strip exactly as the user's own would.
    this.opener.open(id);
    const outcome: HttpOutcome | null = await this.workspace.send(id);
    if (outcome === null) {
      return { ok: false, error: 'The request could not be sent.' };
    }
    if (outcome.kind === 'failure') {
      return {
        ok: false,
        error: outcome.cancelled
          ? 'The send was cancelled.'
          : `The request produced no response: ${outcome.message}`,
      };
    }
    const body: string = outcome.body.slice(0, MAX_AGENT_BODY_CHARS);
    return {
      ok: true,
      status: outcome.status,
      statusText: outcome.statusText,
      durationMs: outcome.timings.totalMs,
      headers: outcome.headers,
      body,
      truncated: body.length < outcome.body.length,
    };
  }

  /**
   * Sets a variable in the active environment, creating an environment when none is active.
   * @param input The tool's arguments.
   * @returns Returns the {@link WriteResult}.
   */
  private setVariable(input: unknown): WriteResult {
    const args: Record<string, unknown> = (input ?? {}) as Record<string, unknown>;
    const name: string = this.text(args['name']).trim();
    if (name === '') {
      return { ok: false, error: 'A variable needs a name.' };
    }
    const value: string = this.text(args['value']);
    const active: ApiEnvironment =
      this.workspace.activeEnvironment() ?? this.workspace.addEnvironment('Default');
    const existing: readonly HttpField[] = active.variables;
    const has: boolean = existing.some((variable: HttpField): boolean => variable.name === name);
    const variables: readonly HttpField[] = has
      ? existing.map(
          (variable: HttpField): HttpField =>
            variable.name === name ? { ...variable, value } : variable,
        )
      : [...existing, newField(name, value)];
    this.workspace.setVariables(active.id, variables);
    this.log.info('api-explorer.agent', 'Agent set an environment variable', { name });
    return { ok: true, environment: active.name };
  }

  /**
   * Resolves the collection a created request belongs in: the one named, created when the name is
   * unknown, else the first collection (or a new one when the tree is empty).
   * @param named The collection name the agent gave, if any.
   * @returns Returns the collection to add to.
   */
  private resolveCollection(named: unknown): ApiFolder {
    const roots: readonly ApiFolder[] = this.workspace
      .folders()
      .filter((folder: ApiFolder): boolean => folder.parentId === null);
    const name: string = this.text(named).trim();
    if (name !== '') {
      return (
        roots.find((folder: ApiFolder): boolean => folder.name === name) ??
        this.workspace.addCollection(name)
      );
    }
    return roots[0] ?? this.workspace.addCollection('My API');
  }

  /**
   * Narrows one of the agent's arguments to a string. The tool schemas declare these as strings, but
   * the value arrives as JSON from a model: anything that is not a string is treated as absent rather
   * than stringified into `[object Object]`.
   * @param value The argument to narrow.
   * @returns Returns the string, or an empty string.
   */
  private text(value: unknown): string {
    return typeof value === 'string' ? value : '';
  }

  /**
   * Converts the agent's name/value object into editable rows.
   * @param value The object the agent supplied, if any.
   * @returns Returns the rows.
   */
  private toFields(value: unknown): readonly HttpField[] {
    if (value === null || typeof value !== 'object') {
      return [];
    }
    return Object.entries(value as Record<string, unknown>).map(
      ([name, entry]: [string, unknown]): HttpField => newField(name, this.text(entry)),
    );
  }

  /**
   * Builds a request body from the agent's text and kind. A body with no stated kind is treated as
   * JSON, which is what an agent describing a modern API almost always means.
   * @param text The body text the agent supplied, if any.
   * @param kind The body kind the agent supplied, if any.
   * @returns Returns the body.
   */
  private toBody(text: unknown, kind: unknown): HttpBody {
    const body: string = this.text(text);
    const stated: HttpBodyKind | undefined = kind as HttpBodyKind | undefined;
    return {
      kind: stated ?? (body === '' ? 'none' : 'json'),
      text: body,
      fields: [],
    };
  }
}
