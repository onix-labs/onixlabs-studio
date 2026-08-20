import { computed, inject, Service, Signal, signal, WritableSignal } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { SettingsStore } from '@shared/angular/services/settings-store/settings-store';
import {
  API_DOCUMENT_KIND,
  API_DOCUMENT_SUFFIX,
  API_DOCUMENT_VERSION,
  ApiDocument,
  ApiEnvironment,
  ApiFolder,
  ApiHistoryEntry,
  ApiRequest,
  HttpAuth,
  HttpBody,
  HttpField,
  HttpMethod,
  HttpOutcome,
  ResolvedHttpRequest,
} from '@shared/api/api-client-types';
import { FileSystem } from '@shared/angular/services/file-system/file-system';
import { Settings } from '@shared/angular/services/settings/settings';
import {
  isNetworkLocationAllowed,
  networkLocationRefusal,
  sanitizeNetworkLocations,
} from '@shared/api/network-locations';
import { FileWriteResult } from '@shared/api/file-channels';
import { ApiHttp } from '../api-http/api-http';

/**
 * The store key the API Explorer's collections, environments and history are persisted under.
 */
const STORE_KEY: string = 'api-explorer.workspace';

/**
 * How many sends the history keeps. Old entries fall off the end rather than growing without bound.
 */
const HISTORY_LIMIT: number = 100;

/**
 * The default per-request timeout, in milliseconds.
 */
const DEFAULT_TIMEOUT_MS: number = 30_000;

/**
 * Who asked for a send: the user working in the view, or the agent through its tools. Only the
 * agent's sends are checked against the allowed network locations.
 */
export type SendOrigin = 'user' | 'agent';

/**
 * The name an unsaved workspace goes by, in the tab and in the save dialog.
 */
const UNTITLED_NAME: string = 'Untitled';

/**
 * Mints an identifier for a folder, request, environment, field or history entry.
 * @returns Returns a new unique identifier.
 */
function newId(): string {
  return crypto.randomUUID();
}

/**
 * Reads the file name out of a path, on either platform's separator.
 * @param path The path to read, or null.
 * @returns Returns the file name, or null when there is no path.
 */
function fileNameOf(path: string | null): string | null {
  return path === null ? null : (/[^\\/]*$/.exec(path)?.[0] ?? path);
}

/**
 * Ensures a chosen save path carries the API document suffix, so a file saved as `orders` is still
 * recognised as an API document when it is opened again. A path already ending in `.json` has that
 * extension replaced rather than doubled, so typing `orders.json` yields `orders.api.json`.
 * @param path The path chosen in the save dialog.
 * @returns Returns the path to write to.
 */
function withApiSuffix(path: string): string {
  const lower: string = path.toLowerCase();
  if (lower.endsWith(API_DOCUMENT_SUFFIX)) {
    return path;
  }
  const base: string = lower.endsWith('.json') ? path.slice(0, -'.json'.length) : path;
  return `${base}${API_DOCUMENT_SUFFIX}`;
}

/**
 * Builds an editable name/value row.
 * @param name The field name.
 * @param value The field value.
 * @returns Returns the new field, enabled.
 */
export function newField(name: string = '', value: string = ''): HttpField {
  return { id: newId(), name, value, enabled: true };
}

/**
 * The API Explorer's document model: the collections, requests, environments and history of one API
 * Explorer tab, the resolution of a saved request into something sendable, and the sending itself.
 *
 * It is deliberately the only place that understands variables. The engine in main is handed a
 * finished request and holds no opinion about `{{base_url}}`; the panels edit and display; this sits
 * between them. That boundary is what lets the agent create a request through the same API a user
 * does, and what would let a second transport (gRPC, GraphQL) reuse the tree without reusing the HTTP
 * semantics.
 *
 * It is also the tab's *document*, and behaves like one in two modes. **Untitled**, it auto-saves to
 * the session store on every edit, so a scratch workspace is never lost and never nags — there is no
 * file for it to be out of step with. **Bound to a file** (opened from a `*.api.json`, or saved to
 * one), the file becomes the only thing that matters: edits mark the document dirty and are written
 * when the user saves, exactly as a code document behaves.
 *
 * Provided by the API Explorer view, so it lives exactly as long as the tab.
 */
@Service()
export class ApiWorkspace {
  /**
   * Holds the persistence store.
   */
  private readonly store: SettingsStore = inject(SettingsStore);

  /**
   * Holds the request engine client.
   */
  private readonly http: ApiHttp = inject(ApiHttp);

  /**
   * Holds the file system the document is saved through.
   */
  private readonly fileSystem: FileSystem = inject(FileSystem);

  /**
   * Holds the settings the agent's allowed network locations are read from.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the collections and folders.
   */
  private readonly foldersSignal: WritableSignal<readonly ApiFolder[]> = signal<
    readonly ApiFolder[]
  >([]);

  /**
   * Holds the saved requests.
   */
  private readonly requestsSignal: WritableSignal<readonly ApiRequest[]> = signal<
    readonly ApiRequest[]
  >([]);

  /**
   * Holds the environments.
   */
  private readonly environmentsSignal: WritableSignal<readonly ApiEnvironment[]> = signal<
    readonly ApiEnvironment[]
  >([]);

  /**
   * Holds the active environment's identifier, or null when none is active.
   */
  private readonly activeEnvironmentIdSignal: WritableSignal<string | null> = signal<string | null>(
    null,
  );

  /**
   * Holds the send history, most recent first.
   */
  private readonly historySignal: WritableSignal<readonly ApiHistoryEntry[]> = signal<
    readonly ApiHistoryEntry[]
  >([]);

  /**
   * Holds the latest outcome per request id, so a request tab still shows its last response after the
   * user switches away and back.
   */
  private readonly outcomesSignal: WritableSignal<ReadonlyMap<string, HttpOutcome>> = signal<
    ReadonlyMap<string, HttpOutcome>
  >(new Map<string, HttpOutcome>());

  /**
   * Holds the ids of requests currently in flight, so their tabs can show progress and offer a cancel.
   */
  private readonly inFlightSignal: WritableSignal<ReadonlySet<string>> = signal<
    ReadonlySet<string>
  >(new Set<string>());

  /**
   * Holds the absolute path this workspace is saved to, or null while it is untitled.
   */
  private readonly filePathSignal: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds whether the bound file has edits that have not been written to it.
   */
  private readonly dirtySignal: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets the absolute path this workspace is saved to, or null while it is untitled.
   */
  public readonly filePath: Signal<string | null> = this.filePathSignal.asReadonly();

  /**
   * Gets whether the workspace has edits not yet written to its file. An untitled workspace is never
   * dirty: it has no file to be out of step with, and every edit is already in the session store.
   */
  public readonly dirty: Signal<boolean> = this.dirtySignal.asReadonly();

  /**
   * Gets the workspace's display name: its file name once saved, otherwise `Untitled`.
   */
  public readonly documentName: Signal<string> = computed(
    (): string => fileNameOf(this.filePathSignal()) ?? UNTITLED_NAME,
  );

  /**
   * Gets the collections and folders.
   */
  public readonly folders: Signal<readonly ApiFolder[]> = this.foldersSignal.asReadonly();

  /**
   * Gets the saved requests.
   */
  public readonly requests: Signal<readonly ApiRequest[]> = this.requestsSignal.asReadonly();

  /**
   * Gets the environments.
   */
  public readonly environments: Signal<readonly ApiEnvironment[]> =
    this.environmentsSignal.asReadonly();

  /**
   * Gets the identifier of the active environment, or null when none is active.
   */
  public readonly activeEnvironmentId: Signal<string | null> =
    this.activeEnvironmentIdSignal.asReadonly();

  /**
   * Gets the send history, most recent first.
   */
  public readonly history: Signal<readonly ApiHistoryEntry[]> = this.historySignal.asReadonly();

  /**
   * Gets the ids of the requests currently in flight.
   */
  public readonly inFlight: Signal<ReadonlySet<string>> = this.inFlightSignal.asReadonly();

  /**
   * Gets the active environment, or null when none is active.
   */
  public readonly activeEnvironment: Signal<ApiEnvironment | null> = computed(
    (): ApiEnvironment | null => {
      const id: string | null = this.activeEnvironmentIdSignal();
      return (
        this.environmentsSignal().find(
          (environment: ApiEnvironment): boolean => environment.id === id,
        ) ?? null
      );
    },
  );

  /**
   * Restores the persisted workspace, seeding a starter collection and environment the first time the
   * view is opened so there is something to send rather than an empty tree.
   */
  public constructor() {
    const persisted: ApiDocument | null = this.store.get<ApiDocument | null>(STORE_KEY, null);
    if (persisted === null) {
      this.seed();
      return;
    }
    this.foldersSignal.set(persisted.folders);
    this.requestsSignal.set(persisted.requests);
    this.environmentsSignal.set(persisted.environments);
    this.activeEnvironmentIdSignal.set(persisted.activeEnvironmentId);
    this.log.info('api-explorer.workspace', 'Restored API workspace', {
      collections: persisted.folders.length,
      requests: persisted.requests.length,
    });
  }

  /**
   * Loads a document read from disk, replacing everything this workspace holds and binding it to the
   * file it came from. From here on the file — not the session store — is where edits are saved, and
   * they are saved when the user says so.
   * @param document The document to load.
   * @param path The absolute path it was read from.
   */
  public load(document: ApiDocument, path: string): void {
    this.foldersSignal.set(document.folders);
    this.requestsSignal.set(document.requests);
    this.environmentsSignal.set(document.environments);
    this.activeEnvironmentIdSignal.set(document.activeEnvironmentId);
    this.historySignal.set([]);
    this.filePathSignal.set(path);
    this.dirtySignal.set(false);
    this.log.info('api-explorer.workspace', 'Loaded API document', {
      path,
      collections: document.folders.length,
      requests: document.requests.length,
    });
  }

  /**
   * Saves the workspace to its file, asking for one first when it is still untitled.
   * @returns Returns a promise resolving true when the document was written, or false when the save
   * was cancelled or failed.
   */
  public async save(): Promise<boolean> {
    const path: string | null = this.filePathSignal();
    if (path === null) {
      return this.saveAs();
    }
    return this.write(path);
  }

  /**
   * Saves the workspace to a newly chosen file, binding it to that file from then on.
   * @returns Returns a promise resolving true when the document was written, or false when the dialog
   * was cancelled or the write failed.
   */
  public async saveAs(): Promise<boolean> {
    const suggested: string = this.filePathSignal() ?? `${UNTITLED_NAME}${API_DOCUMENT_SUFFIX}`;
    const chosen: string | null = await this.fileSystem.saveDialog(suggested);
    if (chosen === null) {
      return false;
    }
    return this.write(withApiSuffix(chosen));
  }

  /**
   * Serialises the workspace as the document written to disk. History is excluded: it is a session's
   * working record, not part of what a user saves.
   * @returns Returns the document.
   */
  public toDocument(): ApiDocument {
    return {
      kind: API_DOCUMENT_KIND,
      version: API_DOCUMENT_VERSION,
      folders: this.foldersSignal(),
      requests: this.requestsSignal(),
      environments: this.environmentsSignal(),
      activeEnvironmentId: this.activeEnvironmentIdSignal(),
    };
  }

  /**
   * Writes the document to a path and binds the workspace to it.
   * @param path The absolute path to write to.
   * @returns Returns a promise resolving true when the write succeeded.
   */
  private async write(path: string): Promise<boolean> {
    const content: string = `${JSON.stringify(this.toDocument(), null, 2)}\n`;
    const result: FileWriteResult = await this.fileSystem.write(path, content);
    if (!result.success) {
      this.log.warn('api-explorer.workspace', 'Save failed', { path });
      return false;
    }
    this.filePathSignal.set(path);
    this.dirtySignal.set(false);
    this.log.info('api-explorer.workspace', 'Saved API document', { path });
    return true;
  }

  /**
   * Gets one saved request by identifier.
   * @param id The request identifier.
   * @returns Returns the request, or undefined when no such request is saved.
   */
  public request(id: string): ApiRequest | undefined {
    return this.requestsSignal().find((request: ApiRequest): boolean => request.id === id);
  }

  /**
   * Gets the latest outcome recorded for a request, or null when it has not been sent this session.
   * @param id The request identifier.
   * @returns Returns the outcome, or null.
   */
  public outcome(id: string): HttpOutcome | null {
    return this.outcomesSignal().get(id) ?? null;
  }

  /**
   * Adds a collection (a root folder).
   * @param name The collection name.
   * @returns Returns the new collection.
   */
  public addCollection(name: string): ApiFolder {
    const folder: ApiFolder = { id: newId(), parentId: null, name };
    this.foldersSignal.update((folders: readonly ApiFolder[]): readonly ApiFolder[] => [
      ...folders,
      folder,
    ]);
    this.persist();
    return folder;
  }

  /**
   * Adds a request to a collection or folder.
   * @param parentId The identifier of the parent collection or folder.
   * @param values The request's initial values; anything omitted takes an empty default.
   * @returns Returns the new request.
   */
  public addRequest(parentId: string, values: Partial<ApiRequest> = {}): ApiRequest {
    const request: ApiRequest = {
      id: newId(),
      parentId,
      name: values.name ?? 'New request',
      method: values.method ?? 'GET',
      url: values.url ?? '',
      params: values.params ?? [],
      headers: values.headers ?? [],
      body: values.body ?? { kind: 'none', text: '', fields: [] },
      auth: values.auth ?? { kind: 'none' },
      description: values.description ?? '',
    };
    this.requestsSignal.update((requests: readonly ApiRequest[]): readonly ApiRequest[] => [
      ...requests,
      request,
    ]);
    this.persist();
    this.log.info('api-explorer.workspace', 'Added request', {
      id: request.id,
      method: request.method,
    });
    return request;
  }

  /**
   * Applies a partial update to a saved request.
   * @param id The request identifier.
   * @param changes The fields to change.
   */
  public updateRequest(id: string, changes: Partial<ApiRequest>): void {
    this.requestsSignal.update((requests: readonly ApiRequest[]): readonly ApiRequest[] =>
      requests.map(
        (request: ApiRequest): ApiRequest =>
          request.id === id ? { ...request, ...changes } : request,
      ),
    );
    this.persist();
  }

  /**
   * Removes a request.
   * @param id The request identifier.
   */
  public removeRequest(id: string): void {
    this.requestsSignal.update((requests: readonly ApiRequest[]): readonly ApiRequest[] =>
      requests.filter((request: ApiRequest): boolean => request.id !== id),
    );
    this.persist();
  }

  /**
   * Removes a collection or folder and everything inside it.
   * @param id The folder identifier.
   */
  public removeFolder(id: string): void {
    const doomed: Set<string> = new Set<string>([id]);
    let grew: boolean = true;
    while (grew) {
      grew = false;
      for (const folder of this.foldersSignal()) {
        if (folder.parentId !== null && doomed.has(folder.parentId) && !doomed.has(folder.id)) {
          doomed.add(folder.id);
          grew = true;
        }
      }
    }
    this.foldersSignal.update((folders: readonly ApiFolder[]): readonly ApiFolder[] =>
      folders.filter((folder: ApiFolder): boolean => !doomed.has(folder.id)),
    );
    this.requestsSignal.update((requests: readonly ApiRequest[]): readonly ApiRequest[] =>
      requests.filter((request: ApiRequest): boolean => !doomed.has(request.parentId)),
    );
    this.persist();
  }

  /**
   * Adds an environment.
   * @param name The environment name.
   * @param variables The environment's initial variables.
   * @returns Returns the new environment.
   */
  public addEnvironment(name: string, variables: readonly HttpField[] = []): ApiEnvironment {
    const environment: ApiEnvironment = { id: newId(), name, variables };
    this.environmentsSignal.update(
      (environments: readonly ApiEnvironment[]): readonly ApiEnvironment[] => [
        ...environments,
        environment,
      ],
    );
    this.activeEnvironmentIdSignal.update(
      (active: string | null): string | null => active ?? environment.id,
    );
    this.persist();
    return environment;
  }

  /**
   * Replaces an environment's variables.
   * @param id The environment identifier.
   * @param variables The variables to store.
   */
  public setVariables(id: string, variables: readonly HttpField[]): void {
    this.environmentsSignal.update(
      (environments: readonly ApiEnvironment[]): readonly ApiEnvironment[] =>
        environments.map(
          (environment: ApiEnvironment): ApiEnvironment =>
            environment.id === id ? { ...environment, variables } : environment,
        ),
    );
    this.persist();
  }

  /**
   * Renames an environment.
   * @param id The environment identifier.
   * @param name The new name.
   */
  public renameEnvironment(id: string, name: string): void {
    this.environmentsSignal.update(
      (environments: readonly ApiEnvironment[]): readonly ApiEnvironment[] =>
        environments.map(
          (environment: ApiEnvironment): ApiEnvironment =>
            environment.id === id ? { ...environment, name } : environment,
        ),
    );
    this.persist();
  }

  /**
   * Removes an environment, clearing the active selection when it was the active one.
   * @param id The environment identifier.
   */
  public removeEnvironment(id: string): void {
    this.environmentsSignal.update(
      (environments: readonly ApiEnvironment[]): readonly ApiEnvironment[] =>
        environments.filter((environment: ApiEnvironment): boolean => environment.id !== id),
    );
    this.activeEnvironmentIdSignal.update((active: string | null): string | null =>
      active === id ? null : active,
    );
    this.persist();
  }

  /**
   * Activates an environment, so subsequent sends resolve their variables from it.
   * @param id The environment identifier, or null to run without one.
   */
  public activateEnvironment(id: string | null): void {
    this.activeEnvironmentIdSignal.set(id);
    this.persist();
    this.log.info('api-explorer.workspace', 'Activated environment', { id });
  }

  /**
   * Substitutes `{{variable}}` references from the active environment. An unknown variable is left
   * exactly as written rather than blanked, so a missing value shows up in the URL bar and in the
   * response as the literal `{{token}}` instead of silently sending a malformed request.
   * @param text The text to substitute into.
   * @returns Returns the substituted text.
   */
  public substitute(text: string): string {
    const environment: ApiEnvironment | null = this.activeEnvironment();
    if (environment === null) {
      return text;
    }
    return text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (whole: string, name: string): string => {
      const variable: HttpField | undefined = environment.variables.find(
        (candidate: HttpField): boolean => candidate.enabled && candidate.name === name,
      );
      return variable?.value ?? whole;
    });
  }

  /**
   * Resolves a saved request into the finished form the engine performs: variables substituted,
   * disabled rows dropped, query parameters applied to the URL, the auth scheme folded into headers
   * or query, and the body reduced to text with a matching content type.
   * @param request The saved request to resolve.
   * @returns Returns the resolved request.
   */
  public resolve(request: ApiRequest): ResolvedHttpRequest {
    const headers: Record<string, string> = {};
    for (const field of this.live(request.headers)) {
      headers[this.substitute(field.name)] = this.substitute(field.value);
    }

    const query: [string, string][] = this.live(request.params).map(
      (field: HttpField): [string, string] => [
        this.substitute(field.name),
        this.substitute(field.value),
      ],
    );

    this.applyAuth(request.auth, headers, query);
    const body: string | null = this.buildBody(request.body, headers);

    return {
      id: request.id,
      method: request.method,
      url: this.buildUrl(this.substitute(request.url).trim(), query),
      headers,
      body,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      followRedirects: true,
    };
  }

  /**
   * Sends a saved request and records the outcome against the request and in the history.
   *
   * A send the *agent* asked for is checked against the allowed network locations first. The user's
   * own sends are not: the whole point of this view is pointing it at any endpoint you like, and the
   * setting names what the **agent** may reach. This is a guard on the agent's tool, not a sandbox —
   * the shell is confined by the OS sandbox instead — so it stops the tool being used to reach a host
   * the user has ruled out, which is the accident and prompt-injection case, not a determined
   * process working around it.
   * @param id The identifier of the request to send.
   * @param origin Who asked for the send; defaults to the user.
   * @returns Returns a promise resolving the outcome, or null when no such request is saved.
   */
  public async send(id: string, origin: SendOrigin = 'user'): Promise<HttpOutcome | null> {
    const request: ApiRequest | undefined = this.request(id);
    if (request === undefined) {
      return null;
    }
    const resolved: ResolvedHttpRequest = this.resolve(request);
    if (origin === 'agent' && !this.mayAgentReach(resolved.url)) {
      const refusal: string = networkLocationRefusal(resolved.url);
      this.log.warn('api-explorer.workspace', 'Agent send blocked by network locations', {
        id,
        url: resolved.url,
      });
      const blocked: HttpOutcome = {
        kind: 'failure',
        id: request.id,
        message: refusal,
        cancelled: false,
        durationMs: 0,
      };
      this.outcomesSignal.update(
        (outcomes: ReadonlyMap<string, HttpOutcome>): ReadonlyMap<string, HttpOutcome> =>
          new Map<string, HttpOutcome>([...outcomes, [id, blocked]]),
      );
      return blocked;
    }
    const at: number = Date.now();
    this.inFlightSignal.update(
      (ids: ReadonlySet<string>): ReadonlySet<string> => new Set<string>([...ids, id]),
    );
    try {
      const outcome: HttpOutcome = await this.http.send(resolved);
      this.outcomesSignal.update(
        (outcomes: ReadonlyMap<string, HttpOutcome>): ReadonlyMap<string, HttpOutcome> =>
          new Map<string, HttpOutcome>([...outcomes, [id, outcome]]),
      );
      this.record({
        id: newId(),
        requestId: request.id,
        name: request.name,
        method: request.method,
        url: resolved.url,
        at,
        outcome,
      });
      return outcome;
    } finally {
      this.inFlightSignal.update((ids: ReadonlySet<string>): ReadonlySet<string> => {
        const next: Set<string> = new Set<string>(ids);
        next.delete(id);
        return next;
      });
    }
  }

  /**
   * Determines whether the agent may reach a URL, by the configured network locations.
   * @param url The resolved URL the send is addressed to.
   * @returns Returns true when the send may proceed.
   */
  private mayAgentReach(url: string): boolean {
    return isNetworkLocationAllowed(
      url,
      sanitizeNetworkLocations(this.settings.aiAllowedNetworkLocations()),
      sanitizeNetworkLocations(this.settings.aiDeniedNetworkLocations()),
    );
  }

  /**
   * Aborts an in-flight request.
   * @param id The identifier of the request to abort.
   */
  public cancel(id: string): void {
    this.http.cancel(id);
  }

  /**
   * Drops the whole send history.
   */
  public clearHistory(): void {
    this.historySignal.set([]);
  }

  /**
   * Keeps only the rows a send should carry: enabled, and with a name.
   * @param fields The rows to filter.
   * @returns Returns the live rows.
   */
  private live(fields: readonly HttpField[]): readonly HttpField[] {
    return fields.filter((field: HttpField): boolean => field.enabled && field.name.trim() !== '');
  }

  /**
   * Folds an auth scheme into the outgoing headers or query.
   * @param auth The scheme to apply.
   * @param headers The headers being built, mutated in place.
   * @param query The query pairs being built, mutated in place.
   */
  private applyAuth(
    auth: HttpAuth,
    headers: Record<string, string>,
    query: [string, string][],
  ): void {
    switch (auth.kind) {
      case 'bearer':
        headers['Authorization'] = `Bearer ${this.substitute(auth.token)}`;
        break;
      case 'basic': {
        const pair: string = `${this.substitute(auth.username)}:${this.substitute(auth.password)}`;
        headers['Authorization'] = `Basic ${btoa(pair)}`;
        break;
      }
      case 'api-key': {
        const key: string = this.substitute(auth.key);
        const value: string = this.substitute(auth.value);
        if (key === '') {
          break;
        }
        if (auth.in === 'header') {
          headers[key] = value;
        } else {
          query.push([key, value]);
        }
        break;
      }
      case 'none':
        break;
    }
  }

  /**
   * Applies query pairs to a URL, preserving any query string the user typed into the URL itself.
   * @param url The base URL, already substituted.
   * @param query The query pairs to apply.
   * @returns Returns the URL to send.
   */
  private buildUrl(url: string, query: readonly [string, string][]): string {
    if (query.length === 0) {
      return url;
    }
    const encoded: string = query
      .map(
        ([name, value]: readonly [string, string]): string =>
          `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
      )
      .join('&');
    return url.includes('?') ? `${url}&${encoded}` : `${url}?${encoded}`;
  }

  /**
   * Reduces a body to the text that goes on the wire, setting the content type when the user has not
   * set one explicitly — an explicit header always wins, because overriding it is a legitimate thing
   * to be testing.
   * @param body The body to build.
   * @param headers The headers being built, mutated in place.
   * @returns Returns the body text, or null when the request carries no body.
   */
  private buildBody(body: HttpBody, headers: Record<string, string>): string | null {
    const has: boolean = Object.keys(headers).some(
      (name: string): boolean => name.toLowerCase() === 'content-type',
    );
    const setType: (value: string) => void = (value: string): void => {
      if (!has) {
        headers['Content-Type'] = value;
      }
    };

    switch (body.kind) {
      case 'none':
        return null;
      case 'json':
        setType('application/json');
        return this.substitute(body.text);
      case 'xml':
        setType('application/xml');
        return this.substitute(body.text);
      case 'text':
        setType('text/plain');
        return this.substitute(body.text);
      case 'urlencoded':
        setType('application/x-www-form-urlencoded');
        return this.live(body.fields)
          .map(
            (field: HttpField): string =>
              `${encodeURIComponent(this.substitute(field.name))}=${encodeURIComponent(
                this.substitute(field.value),
              )}`,
          )
          .join('&');
      case 'form': {
        // Multipart is assembled here rather than with FormData because the body crosses IPC as text.
        // Text fields only: file parts need a byte channel, which the spike does not have.
        const boundary: string = `----StudioFormBoundary${newId().replace(/-/g, '')}`;
        setType(`multipart/form-data; boundary=${boundary}`);
        const parts: string = this.live(body.fields)
          .map(
            (field: HttpField): string =>
              `--${boundary}\r\nContent-Disposition: form-data; name="${this.substitute(
                field.name,
              )}"\r\n\r\n${this.substitute(field.value)}\r\n`,
          )
          .join('');
        return `${parts}--${boundary}--\r\n`;
      }
    }
  }

  /**
   * Pushes a history entry, trimming the oldest beyond the limit.
   * @param entry The entry to record.
   */
  private record(entry: ApiHistoryEntry): void {
    this.historySignal.update((history: readonly ApiHistoryEntry[]): readonly ApiHistoryEntry[] =>
      [entry, ...history].slice(0, HISTORY_LIMIT),
    );
  }

  /**
   * Records an edit. A workspace bound to a file becomes dirty and waits to be saved — the file is the
   * user's, and writing to it behind their back is not this view's decision. An untitled workspace has
   * no file to be out of step with, so it keeps auto-saving to the session store exactly as it did
   * before documents existed: a scratch workspace survives a restart without ever being saved.
   */
  private persist(): void {
    if (this.filePathSignal() !== null) {
      this.dirtySignal.set(true);
      return;
    }
    this.store.set<ApiDocument>(STORE_KEY, this.toDocument());
  }

  /**
   * Seeds a first-run workspace: one collection with a request that returns something, and a local
   * environment with the `base_url` the request is written against. The point is that the view opens
   * with something a user can press Send on and see work, rather than an empty tree and a blank tab.
   */
  private seed(): void {
    const collection: ApiFolder = this.addCollection('My API');
    this.addEnvironment('Localhost', [newField('base_url', 'http://localhost:8080')]);
    this.addRequest(collection.id, {
      name: 'Example request',
      method: 'GET' as HttpMethod,
      url: 'https://api.github.com/repos/onix-labs/onixlabs-studio',
      headers: [newField('Accept', 'application/vnd.github+json')],
      description: 'A request that works out of the box, so Send does something on first open.',
    });
    this.log.info('api-explorer.workspace', 'Seeded a starter API workspace');
  }
}
