/**
 * The domain types of the API Explorer, shared by the renderer view and the main-process request
 * engine. A saved request is data, not behaviour: the renderer edits it, persists it, and hands a
 * fully-resolved copy to main, which performs it and hands back a result. Nothing here depends on
 * Angular or on Electron, so both halves compile against the same shapes.
 */

/**
 * The HTTP methods the API Explorer can send. Deliberately the common set rather than every method
 * IANA lists — an arbitrary method is a request-settings concern, not a first-class picker entry.
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

/**
 * Every {@link HttpMethod}, in the order the method picker offers them: the safe read first, then the
 * writes in the order they are most often reached for.
 */
export const HTTP_METHODS: readonly HttpMethod[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
];

/**
 * One editable name/value row — a query parameter, a header, or a form field. Rows carry their own
 * enabled flag so a user can keep a parameter around without sending it, exactly as the tick boxes in
 * the reference tools do; a disabled row is dropped when the request is resolved.
 */
export interface HttpField {
  /**
   * Gets the stable identifier of the row, so the editor can track rows across edits.
   */
  readonly id: string;

  /**
   * Gets the field's name. An empty name marks the trailing placeholder row, which is never sent.
   */
  readonly name: string;

  /**
   * Gets the field's value, before variable substitution.
   */
  readonly value: string;

  /**
   * Gets whether the row is sent. Defaults to true for a row the user has typed into.
   */
  readonly enabled: boolean;
}

/**
 * How a request carries its body. `none` is the absence of a body (the default for a GET); `json`,
 * `text` and `xml` are raw text with a matching content type; `form` is `multipart/form-data` and
 * `urlencoded` is `application/x-www-form-urlencoded`, both built from {@link HttpBody.fields}.
 */
export type HttpBodyKind = 'none' | 'json' | 'text' | 'xml' | 'form' | 'urlencoded';

/**
 * A request's body: its kind, the raw text for the text kinds, and the fields for the form kinds.
 * Both are kept across a kind change, so switching from JSON to form and back does not discard what
 * was typed.
 */
export interface HttpBody {
  /**
   * Gets how the body is carried.
   */
  readonly kind: HttpBodyKind;

  /**
   * Gets the raw body text, used by the `json`, `text` and `xml` kinds.
   */
  readonly text: string;

  /**
   * Gets the form fields, used by the `form` and `urlencoded` kinds.
   */
  readonly fields: readonly HttpField[];
}

/**
 * How a request authenticates. Modelled as a discriminated union so the editor renders only the
 * inputs a scheme actually needs, and so a scheme added later (OAuth 2, AWS SigV4) is a new member
 * rather than a widening of an options bag.
 */
export type HttpAuth =
  | { readonly kind: 'none' }
  | { readonly kind: 'bearer'; readonly token: string }
  | { readonly kind: 'basic'; readonly username: string; readonly password: string }
  | {
      readonly kind: 'api-key';
      readonly key: string;
      readonly value: string;
      readonly in: 'header' | 'query';
    };

/**
 * A saved request as the user edits it — the unit the API Explorer stores, the well opens as a tab,
 * and the agent creates. Values may contain `{{variable}}` references; they are substituted from the
 * active environment when the request is resolved for sending, never in place.
 */
export interface ApiRequest {
  /**
   * Gets the stable identifier of the request. Also the dock panel id when it is open in the well.
   */
  readonly id: string;

  /**
   * Gets the identifier of the collection or folder the request belongs to.
   */
  readonly parentId: string;

  /**
   * Gets the display name of the request.
   */
  readonly name: string;

  /**
   * Gets the HTTP method.
   */
  readonly method: HttpMethod;

  /**
   * Gets the request URL, before variable substitution and before query parameters are applied.
   */
  readonly url: string;

  /**
   * Gets the query parameters.
   */
  readonly params: readonly HttpField[];

  /**
   * Gets the request headers.
   */
  readonly headers: readonly HttpField[];

  /**
   * Gets the request body.
   */
  readonly body: HttpBody;

  /**
   * Gets how the request authenticates.
   */
  readonly auth: HttpAuth;

  /**
   * Gets a free-text description. The agent writes what an endpoint does here when it adds one, so
   * the explanation lives beside the request rather than only in the conversation.
   */
  readonly description: string;
}

/**
 * A folder in the API Explorer tree. A collection is a folder with no parent, which is why one type
 * serves both: the tree is uniform, and a collection is simply a root.
 */
export interface ApiFolder {
  /**
   * Gets the stable identifier of the folder.
   */
  readonly id: string;

  /**
   * Gets the identifier of the parent folder, or null for a collection (a root).
   */
  readonly parentId: string | null;

  /**
   * Gets the display name of the folder.
   */
  readonly name: string;
}

/**
 * A named set of variables — a base URL, a token, an account id — that requests reference as
 * `{{name}}`. Exactly one environment is active at a time, and the active one is what a send
 * resolves against.
 */
export interface ApiEnvironment {
  /**
   * Gets the stable identifier of the environment.
   */
  readonly id: string;

  /**
   * Gets the display name of the environment, shown in the explorer tree and the ribbon picker.
   */
  readonly name: string;

  /**
   * Gets the environment's variables.
   */
  readonly variables: readonly HttpField[];
}

/**
 * The moniker every API document carries, so a file can be recognised as one before it is loaded.
 * A `*.api.json` whose moniker is absent or different is not this application's document and is left
 * to the text editor, rather than being read as one and silently mangled.
 */
export const API_DOCUMENT_KIND: string = 'onixlabs.studio.api';

/**
 * The file-name suffix an API document is saved under. It is a double extension on purpose: the
 * document is ordinary JSON — legible, diffable, and editable in the code editor — while the `.api`
 * part is what routes it to the API Explorer rather than to a text tab. A plain `.json` file is
 * untouched by this.
 */
export const API_DOCUMENT_SUFFIX: string = '.api.json';

/**
 * The saved form of an API Explorer document: the environments, the collections and the requests of
 * one API workspace, as they are written to disk.
 *
 * It is versioned from the outset so a later change to the request model can migrate rather than
 * discard what a user has saved, and it is deliberately the same shape the view holds in memory —
 * `folders` with a null `parentId` are the collections, the rest are folders within them.
 */
export interface ApiDocument {
  /**
   * Gets the moniker identifying this as an API Explorer document; always {@link API_DOCUMENT_KIND}.
   */
  readonly kind: string;

  /**
   * Gets the schema version of the document.
   */
  readonly version: number;

  /**
   * Gets the collections and the folders within them.
   */
  readonly folders: readonly ApiFolder[];

  /**
   * Gets the saved requests.
   */
  readonly requests: readonly ApiRequest[];

  /**
   * Gets the environments.
   */
  readonly environments: readonly ApiEnvironment[];

  /**
   * Gets the identifier of the active environment, or null when none is active.
   */
  readonly activeEnvironmentId: string | null;
}

/**
 * The schema version this application writes.
 */
export const API_DOCUMENT_VERSION: number = 1;

/**
 * Determines whether a file name is an API document by its suffix. Name-based, so routing an opened
 * file costs nothing: only a file that claims to be one is read and checked for its moniker.
 * @param fileName The file name to test.
 * @returns Returns true when the name ends with the API document suffix.
 */
export function isApiDocumentName(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(API_DOCUMENT_SUFFIX);
}

/**
 * A request resolved for sending: every `{{variable}}` substituted, every disabled row dropped, the
 * auth scheme folded into headers or query, and the body reduced to what goes on the wire. This — not
 * {@link ApiRequest} — is what crosses to the main process, so the engine performs exactly what it is
 * given and holds no opinion about variables, collections, or the tree.
 */
export interface ResolvedHttpRequest {
  /**
   * Gets the identifier correlating the send with its result and with a cancellation.
   */
  readonly id: string;

  /**
   * Gets the HTTP method to perform.
   */
  readonly method: HttpMethod;

  /**
   * Gets the fully-substituted absolute URL, query string included.
   */
  readonly url: string;

  /**
   * Gets the headers to send, as resolved name/value pairs.
   */
  readonly headers: Readonly<Record<string, string>>;

  /**
   * Gets the body to send as text, or null when the request has no body.
   */
  readonly body: string | null;

  /**
   * Gets how long to wait, in milliseconds, before aborting the request.
   */
  readonly timeoutMs: number;

  /**
   * Gets whether redirects are followed. When false the redirect response itself is returned, which
   * is what a user debugging a redirect chain wants to see.
   */
  readonly followRedirects: boolean;
}

/**
 * Where the time went in a completed request. The engine reports what it can observe around its own
 * call; a full DNS/TCP/TLS breakdown would need a lower-level client than `fetch` and is deliberately
 * not faked here.
 */
export interface HttpTimings {
  /**
   * Gets the milliseconds until the response head (status and headers) arrived.
   */
  readonly firstByteMs: number;

  /**
   * Gets the total milliseconds from send to the body being fully read.
   */
  readonly totalMs: number;
}

/**
 * The outcome of a send: either a response (however unsuccessful its status) or a failure to obtain
 * one. A 500 is a response; a refused connection, a bad host, a timeout, or a cancellation is an
 * {@link HttpFailure} — the distinction the user cares about and the one a status code cannot carry.
 */
export type HttpOutcome = HttpResponse | HttpFailure;

/**
 * A response that arrived, whatever its status.
 */
export interface HttpResponse {
  /**
   * Discriminates the successful outcome.
   */
  readonly kind: 'response';

  /**
   * Gets the identifier of the request this answers.
   */
  readonly id: string;

  /**
   * Gets the HTTP status code.
   */
  readonly status: number;

  /**
   * Gets the HTTP status text, where the server supplied one.
   */
  readonly statusText: string;

  /**
   * Gets the response headers, lower-cased by the platform.
   */
  readonly headers: Readonly<Record<string, string>>;

  /**
   * Gets the response body decoded as text. Binary bodies are returned as their decoded text form;
   * rendering them sensibly is the viewer's problem, not the engine's.
   */
  readonly body: string;

  /**
   * Gets the body size in bytes, as measured on the wire rather than after decoding.
   */
  readonly sizeBytes: number;

  /**
   * Gets the URL the response actually came from, which differs from the request URL when redirects
   * were followed.
   */
  readonly finalUrl: string;

  /**
   * Gets whether the response was reached through one or more redirects.
   */
  readonly redirected: boolean;

  /**
   * Gets where the time went.
   */
  readonly timings: HttpTimings;
}

/**
 * A send that produced no response.
 */
export interface HttpFailure {
  /**
   * Discriminates the failed outcome.
   */
  readonly kind: 'failure';

  /**
   * Gets the identifier of the request this answers.
   */
  readonly id: string;

  /**
   * Gets why no response was obtained, in terms fit to show the user.
   */
  readonly message: string;

  /**
   * Gets whether the failure was the user cancelling, which is not an error and is presented
   * differently.
   */
  readonly cancelled: boolean;

  /**
   * Gets the milliseconds spent before the attempt ended.
   */
  readonly durationMs: number;
}

/**
 * One entry in the send history: what was sent, and what came back. Held in the renderer so the
 * History panel can replay a request without the engine keeping any state of its own.
 */
export interface ApiHistoryEntry {
  /**
   * Gets the stable identifier of the history entry.
   */
  readonly id: string;

  /**
   * Gets the identifier of the saved request this send came from, or null for an unsaved one.
   */
  readonly requestId: string | null;

  /**
   * Gets the display name of the request as it was when sent.
   */
  readonly name: string;

  /**
   * Gets the method that was sent.
   */
  readonly method: HttpMethod;

  /**
   * Gets the resolved URL that was sent.
   */
  readonly url: string;

  /**
   * Gets the epoch milliseconds at which the send started.
   */
  readonly at: number;

  /**
   * Gets the outcome of the send.
   */
  readonly outcome: HttpOutcome;
}
