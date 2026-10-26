import { computed, effect, inject, Service, Signal, signal, WritableSignal } from '@angular/core';
import {
  ConnectionValues,
  ConnectOutcome,
  DatabaseEngineInfo,
  DatabaseNode,
  DatabaseValue,
  ExecuteOutcome,
  ExpandOutcome,
  NodeActionOutcome,
  ResultSet,
} from '@shared/api/database-engine-protocol';
import {
  DATABASE_DOCUMENT_KIND,
  DATABASE_DOCUMENT_SUFFIX,
  DATABASE_DOCUMENT_VERSION,
  DatabaseConnection,
  DatabaseDocument,
  DatabaseQuery,
  PassphraseLock,
  SealedSecrets,
} from '@shared/api/database-document';
import { PassphraseUnlock } from '@shared/api/database-channels';
import { FileWriteResult } from '@shared/api/file-channels';
import { FileSystem } from '@shared/angular/services/file-system/file-system';
import { Log } from '@shared/angular/services/log/log';
import { DatabaseEnginePrompt } from '@shared/angular/services/plugins/database-engine-prompt';
import { Settings } from '@shared/angular/services/settings/settings';
import { DatabaseClient } from '../database-client/database-client';

/**
 * The name an unsaved document goes by.
 */
const UNTITLED_NAME: string = 'Untitled';

/**
 * How many rows each Load More fetches.
 */
const FETCH_PAGE_ROWS: number = 1_000;

/**
 * An open connection's session.
 */
export interface OpenSession {
  /**
   * Gets the session's id in main.
   */
  readonly session: string;

  /**
   * Gets the server's description of itself.
   */
  readonly serverVersion: string;
}

/**
 * The loading state of one tree node's children.
 */
export type NodeChildren =
  | { readonly state: 'loading' }
  | { readonly state: 'loaded'; readonly nodes: readonly DatabaseNode[] }
  | { readonly state: 'failed'; readonly message: string };

/**
 * What the Properties panel is showing: a tree node, a connection, or a graph element picked in the
 * Graph view.
 */
export type DatabaseSelection =
  | { readonly kind: 'connection'; readonly connectionId: string }
  | { readonly kind: 'node'; readonly connectionId: string; readonly node: DatabaseNode }
  | {
      readonly kind: 'graph';
      readonly title: string;
      readonly properties: readonly { readonly name: string; readonly value: string }[];
    };

/**
 * Mints an identifier.
 * @returns Returns a new unique identifier.
 */
function newId(): string {
  return crypto.randomUUID();
}

/**
 * Reads the file name out of a path.
 * @param path The path, or null.
 * @returns Returns the file name, or null.
 */
function fileNameOf(path: string | null): string | null {
  return path === null ? null : (/[^\\/]*$/.exec(path)?.[0] ?? path);
}

/**
 * Ensures a chosen save path carries the database document suffix.
 * @param path The chosen path.
 * @returns Returns the path to write.
 */
function withDatabaseSuffix(path: string): string {
  const lower: string = path.toLowerCase();
  if (lower.endsWith(DATABASE_DOCUMENT_SUFFIX)) {
    return path;
  }
  const base: string = lower.endsWith('.json') ? path.slice(0, -'.json'.length) : path;
  return `${base}${DATABASE_DOCUMENT_SUFFIX}`;
}

/**
 * The key a node's children are cached under: its connection and its path (empty for the top).
 * @param connectionId The connection.
 * @param path The node's path, or null for the top of the tree.
 * @returns Returns the cache key.
 */
export function nodeKey(connectionId: string, path: string | null): string {
  return `${connectionId}\u0000${path ?? ''}`;
}

/**
 * The Database Explorer's model for one tab: the document (its connections and queries), the
 * open sessions, the object tree as far as it has been expanded, and every query's latest outcome.
 *
 * It is the tab's *document* exactly as the API Explorer's workspace is: edits mark it dirty, closing
 * it offers to save, an untitled one asks where, and once saved it is bound to its `*.database.json`.
 * What is not part of the document is just as deliberate — sessions, the expanded tree and results are
 * the session's working state, and secrets live only in memory, for the session (#1097 keeps them in
 * the document, encrypted).
 *
 * Provided by the Database Explorer view, so it lives exactly as long as the tab.
 */
@Service()
export class DatabaseWorkspace {
  /**
   * Holds the engine client.
   */
  private readonly client: DatabaseClient = inject(DatabaseClient);

  /**
   * Holds the file system the document is saved through.
   */
  private readonly fileSystem: FileSystem = inject(FileSystem);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the settings, read for what a select action does.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds which engines the installed plugins contribute, watched so an engine installed while the tab
   * is open can be connected with at once.
   */
  private readonly enginePrompt: DatabaseEnginePrompt = inject(DatabaseEnginePrompt);

  private readonly enginesSignal: WritableSignal<readonly DatabaseEngineInfo[]> = signal<
    readonly DatabaseEngineInfo[]
  >([]);
  private readonly enginesKnownSignal: WritableSignal<boolean> = signal<boolean>(false);
  private readonly connectionsSignal: WritableSignal<readonly DatabaseConnection[]> = signal<
    readonly DatabaseConnection[]
  >([]);
  private readonly queriesSignal: WritableSignal<readonly DatabaseQuery[]> = signal<
    readonly DatabaseQuery[]
  >([]);
  private readonly sessionsSignal: WritableSignal<ReadonlyMap<string, OpenSession>> = signal<
    ReadonlyMap<string, OpenSession>
  >(new Map<string, OpenSession>());
  private readonly connectingSignal: WritableSignal<ReadonlySet<string>> = signal<
    ReadonlySet<string>
  >(new Set<string>());
  private readonly connectionErrorsSignal: WritableSignal<ReadonlyMap<string, string>> = signal<
    ReadonlyMap<string, string>
  >(new Map<string, string>());
  private readonly childrenSignal: WritableSignal<ReadonlyMap<string, NodeChildren>> = signal<
    ReadonlyMap<string, NodeChildren>
  >(new Map<string, NodeChildren>());
  private readonly outcomesSignal: WritableSignal<ReadonlyMap<string, ExecuteOutcome>> = signal<
    ReadonlyMap<string, ExecuteOutcome>
  >(new Map<string, ExecuteOutcome>());
  private readonly runningSignal: WritableSignal<ReadonlyMap<string, string>> = signal<
    ReadonlyMap<string, string>
  >(new Map<string, string>());
  private readonly selectionSignal: WritableSignal<DatabaseSelection | null> =
    signal<DatabaseSelection | null>(null);
  private readonly filePathSignal: WritableSignal<string | null> = signal<string | null>(null);
  private readonly dirtySignal: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds each connection's secrets for this session, keyed by connection id. Saved only sealed, and
   * only for a connection whose secrets are remembered.
   */
  private readonly secrets: Map<string, Readonly<Record<string, string>>> = new Map<
    string,
    Readonly<Record<string, string>>
  >();

  /**
   * Holds the connections whose secrets are remembered in the document (#1097).
   */
  private readonly rememberedSignal: WritableSignal<ReadonlySet<string>> = signal<
    ReadonlySet<string>
  >(new Set<string>());

  /**
   * Holds the seals read from disk that this session could not open — sealed on another machine, or
   * with a passphrase not yet given. They are written back as they were, so the machine or passphrase
   * that made them can still open them.
   */
  private readonly unopened: Map<string, SealedSecrets> = new Map<string, SealedSecrets>();

  /**
   * Holds the document's passphrase lock, or null when its secrets are sealed with the machine's key.
   */
  private readonly lockSignal: WritableSignal<PassphraseLock | null> =
    signal<PassphraseLock | null>(null);

  /**
   * Holds the handle of the unlocked passphrase's key in main, or null while it is locked or absent.
   */
  private readonly passphraseHandle: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds whether this machine can seal secrets with its keychain, once main has said.
   */
  private readonly machineSealingSignal: WritableSignal<boolean> = signal<boolean>(true);

  /**
   * Gets the engines available to connect with.
   */
  public readonly engines: Signal<readonly DatabaseEngineInfo[]> = this.enginesSignal.asReadonly();

  /**
   * Gets whether the document has a passphrase.
   */
  public readonly hasPassphrase: Signal<boolean> = computed(
    (): boolean => this.lockSignal() !== null,
  );

  /**
   * Gets whether the document has a passphrase this session has not unlocked, so its passphrase-sealed
   * secrets are still shut.
   */
  public readonly locked: Signal<boolean> = computed(
    (): boolean => this.lockSignal() !== null && this.passphraseHandle() === null,
  );

  /**
   * Gets whether a remembered secret can be sealed now: with the unlocked passphrase, or with the
   * machine's keychain when there is one.
   */
  public readonly canRemember: Signal<boolean> = computed((): boolean =>
    this.lockSignal() === null ? this.machineSealingSignal() : this.passphraseHandle() !== null,
  );

  /**
   * Gets whether main has said which engines there are, so "none is installed" is not said while it is
   * still being asked.
   */
  public readonly enginesKnown: Signal<boolean> = this.enginesKnownSignal.asReadonly();

  /**
   * Gets the saved connections.
   */
  public readonly connections: Signal<readonly DatabaseConnection[]> =
    this.connectionsSignal.asReadonly();

  /**
   * Gets the saved queries.
   */
  public readonly queries: Signal<readonly DatabaseQuery[]> = this.queriesSignal.asReadonly();

  /**
   * Gets the open sessions, keyed by connection id.
   */
  public readonly sessions: Signal<ReadonlyMap<string, OpenSession>> =
    this.sessionsSignal.asReadonly();

  /**
   * Gets the connections being opened.
   */
  public readonly connecting: Signal<ReadonlySet<string>> = this.connectingSignal.asReadonly();

  /**
   * Gets why each connection's last attempt failed, keyed by connection id.
   */
  public readonly connectionErrors: Signal<ReadonlyMap<string, string>> =
    this.connectionErrorsSignal.asReadonly();

  /**
   * Gets the tree's loaded children, keyed by {@link nodeKey}.
   */
  public readonly children: Signal<ReadonlyMap<string, NodeChildren>> =
    this.childrenSignal.asReadonly();

  /**
   * Gets the running executions, as execution ids keyed by query id.
   */
  public readonly running: Signal<ReadonlyMap<string, string>> = this.runningSignal.asReadonly();

  /**
   * Gets what the Properties panel is showing.
   */
  public readonly selection: Signal<DatabaseSelection | null> = this.selectionSignal.asReadonly();

  /**
   * Gets the path the document is saved to, or null while untitled.
   */
  public readonly filePath: Signal<string | null> = this.filePathSignal.asReadonly();

  /**
   * Gets whether the document has unsaved edits.
   */
  public readonly dirty: Signal<boolean> = this.dirtySignal.asReadonly();

  /**
   * Gets the document's display name.
   */
  public readonly documentName: Signal<string> = computed(
    (): string => fileNameOf(this.filePathSignal()) ?? UNTITLED_NAME,
  );

  /**
   * Starts an untitled document and asks main which engines it has — again whenever the installed
   * plugins' engines change, so installing one from the empty state is all it takes.
   */
  public constructor() {
    void this.client.canSealWithMachine().then((can: boolean): void => {
      this.machineSealingSignal.set(can);
    });
    effect((): void => {
      this.enginePrompt.installedKey();
      void this.client.engines().then((engines: readonly DatabaseEngineInfo[]): void => {
        this.enginesSignal.set(engines);
        this.enginesKnownSignal.set(true);
        this.log.info(
          'database.workspace',
          'Engines available',
          engines.map((engine: DatabaseEngineInfo): string => engine.id),
        );
      });
    });
  }

  // --- The document ---

  /**
   * Loads a document read from disk, binding the workspace to its file.
   * @param document The document.
   * @param path The path it was read from.
   */
  public load(document: DatabaseDocument, path: string): void {
    // The seals are held apart from the connections, so nothing that reads a connection — the tree,
    // the agent — ever carries one.
    this.unopened.clear();
    for (const connection of document.connections) {
      if (connection.secrets !== undefined) {
        this.unopened.set(connection.id, connection.secrets);
      }
    }
    this.connectionsSignal.set(
      document.connections.map((connection: DatabaseConnection): DatabaseConnection => ({
        id: connection.id,
        name: connection.name,
        engine: connection.engine,
        values: connection.values,
      })),
    );
    this.rememberedSignal.set(new Set<string>(this.unopened.keys()));
    this.forgetPassphrase();
    this.lockSignal.set(document.passphrase ?? null);
    this.queriesSignal.set(document.queries);
    this.filePathSignal.set(path);
    this.dirtySignal.set(false);
    void this.openSealed();
    this.log.info('database.workspace', 'Loaded database document', {
      path,
      connections: document.connections.length,
      queries: document.queries.length,
    });
  }

  /**
   * Serialises the document without its secrets. Sessions and results are never part of it.
   * @returns Returns the document.
   */
  public toDocument(): DatabaseDocument {
    const lock: PassphraseLock | null = this.lockSignal();
    return {
      kind: DATABASE_DOCUMENT_KIND,
      version: DATABASE_DOCUMENT_VERSION,
      connections: this.connectionsSignal(),
      queries: this.queriesSignal(),
      ...(lock === null ? {} : { passphrase: lock }),
    };
  }

  /**
   * Serialises the document as it is saved: each remembered connection's secrets sealed by main —
   * with the passphrase when the document has one, else with the machine's keychain — and a seal this
   * session could not open written back as it was read.
   * @returns Returns a promise resolving the document.
   */
  public async toSavedDocument(): Promise<DatabaseDocument> {
    const handle: string | null = this.passphraseHandle();
    const remembered: ReadonlySet<string> = this.rememberedSignal();
    const document: DatabaseDocument = this.toDocument();
    const connections: DatabaseConnection[] = await Promise.all(
      document.connections.map(
        async (connection: DatabaseConnection): Promise<DatabaseConnection> => {
          if (!remembered.has(connection.id)) {
            return connection;
          }
          const held: Readonly<Record<string, string>> | undefined = this.secrets.get(
            connection.id,
          );
          if (held !== undefined && Object.keys(held).length > 0 && this.canRemember()) {
            const sealed: SealedSecrets | null = await this.client.seal(held, handle);
            if (sealed !== null) {
              return { ...connection, secrets: sealed };
            }
          }
          const kept: SealedSecrets | undefined = this.unopened.get(connection.id);
          return kept === undefined ? connection : { ...connection, secrets: kept };
        },
      ),
    );
    return { ...document, connections };
  }

  /**
   * Saves the document, asking for a file first when it is untitled.
   * @returns Returns a promise resolving true when it was written.
   */
  public async save(): Promise<boolean> {
    const path: string | null = this.filePathSignal();
    return path === null ? this.saveAs() : this.write(path);
  }

  /**
   * Saves the document to a newly chosen file.
   * @returns Returns a promise resolving true when it was written.
   */
  public async saveAs(): Promise<boolean> {
    const chosen: string | null = await this.fileSystem.saveDialog(
      this.filePathSignal() ?? `${UNTITLED_NAME}${DATABASE_DOCUMENT_SUFFIX}`,
    );
    return chosen === null ? false : this.write(withDatabaseSuffix(chosen));
  }

  /**
   * Writes the document and binds the workspace to the file.
   * @param path The path.
   * @returns Returns a promise resolving true when it was written.
   */
  private async write(path: string): Promise<boolean> {
    const result: FileWriteResult = await this.fileSystem.write(
      path,
      `${JSON.stringify(await this.toSavedDocument(), null, 2)}\n`,
    );
    if (!result.success) {
      this.log.warn('database.workspace', 'Save failed', { path });
      return false;
    }
    this.filePathSignal.set(path);
    this.dirtySignal.set(false);
    return true;
  }

  // --- Connections ---

  /**
   * Gets an engine by id.
   * @param id The engine's id.
   * @returns Returns the engine, or undefined when it is not available.
   */
  public engine(id: string): DatabaseEngineInfo | undefined {
    return this.enginesSignal().find((engine: DatabaseEngineInfo): boolean => engine.id === id);
  }

  /**
   * Gets a connection by id.
   * @param id The connection's id.
   * @returns Returns the connection, or undefined.
   */
  public connection(id: string | null): DatabaseConnection | undefined {
    return this.connectionsSignal().find(
      (connection: DatabaseConnection): boolean => connection.id === id,
    );
  }

  /**
   * Adds a connection, holding its secrets for the session.
   * @param name The connection's name.
   * @param engine The engine's id.
   * @param values Every field value, secrets included; the secrets are split off and never saved.
   * @returns Returns the new connection.
   */
  public addConnection(
    name: string,
    engine: string,
    values: ConnectionValues,
    remember: boolean = true,
  ): DatabaseConnection {
    const connection: DatabaseConnection = {
      id: newId(),
      name,
      engine,
      values: this.publicValues(engine, values),
    };
    this.secrets.set(connection.id, this.secretValues(engine, values));
    this.setRemembered(connection.id, remember);
    this.connectionsSignal.update(
      (connections: readonly DatabaseConnection[]): readonly DatabaseConnection[] => [
        ...connections,
        connection,
      ],
    );
    this.touch();
    return connection;
  }

  /**
   * Replaces a connection's name and values, closing its session so the next use reconnects with them.
   * @param id The connection's id.
   * @param name The new name.
   * @param values Every field value, secrets included.
   */
  public async updateConnection(
    id: string,
    name: string,
    values: ConnectionValues,
    remember: boolean = this.remembers(id),
  ): Promise<void> {
    const existing: DatabaseConnection | undefined = this.connection(id);
    if (existing === undefined) {
      return;
    }
    this.secrets.set(id, this.secretValues(existing.engine, values));
    this.unopened.delete(id);
    this.setRemembered(id, remember);
    this.connectionsSignal.update(
      (connections: readonly DatabaseConnection[]): readonly DatabaseConnection[] =>
        connections.map((connection: DatabaseConnection): DatabaseConnection =>
          connection.id === id
            ? { ...connection, name, values: this.publicValues(existing.engine, values) }
            : connection,
        ),
    );
    this.touch();
    await this.disconnect(id);
  }

  /**
   * Removes a connection and the queries written against it, closing its session. Queries live under
   * their connection in the Object Explorer, so a query whose connection is gone would have nowhere
   * to be found; it goes with it, and the confirmation says so.
   * @param id The connection's id.
   */
  public async removeConnection(id: string): Promise<void> {
    await this.disconnect(id);
    this.secrets.delete(id);
    this.unopened.delete(id);
    this.setRemembered(id, false);
    this.connectionsSignal.update(
      (connections: readonly DatabaseConnection[]): readonly DatabaseConnection[] =>
        connections.filter((connection: DatabaseConnection): boolean => connection.id !== id),
    );
    this.queriesSignal.update((queries: readonly DatabaseQuery[]): readonly DatabaseQuery[] =>
      queries.filter((query: DatabaseQuery): boolean => query.connectionId !== id),
    );
    if (this.selectionSignal()?.kind !== 'graph') {
      this.selectionSignal.set(null);
    }
    this.touch();
  }

  /**
   * Gets every field value of a connection, secrets included, as the connection dialog edits them.
   * @param id The connection's id.
   * @returns Returns the values.
   */
  public valuesFor(id: string): ConnectionValues {
    return { ...(this.connection(id)?.values ?? {}), ...(this.secrets.get(id) ?? {}) };
  }

  /**
   * Determines whether a connection has secret fields this session has no value for yet, so the view
   * asks for them before connecting.
   * @param id The connection's id.
   * @returns Returns true when a secret is still to be entered.
   */
  public needsSecrets(id: string): boolean {
    const connection: DatabaseConnection | undefined = this.connection(id);
    const engine: DatabaseEngineInfo | undefined =
      connection === undefined ? undefined : this.engine(connection.engine);
    if (engine === undefined) {
      return false;
    }
    const held: Readonly<Record<string, string>> | undefined = this.secrets.get(id);
    return engine.connectionFields.some((field) => field.secret === true) && held === undefined;
  }

  /**
   * Holds secrets entered for a connection, for this session.
   * @param id The connection's id.
   * @param values The values entered; only the secret ones are kept.
   */
  public provideSecrets(id: string, values: ConnectionValues, remember?: boolean): void {
    const connection: DatabaseConnection | undefined = this.connection(id);
    if (connection === undefined) {
      return;
    }
    this.secrets.set(id, this.secretValues(connection.engine, values));
    if (remember !== undefined) {
      // Entering a secret worth remembering changes what the document saves, even when the
      // connection was already remembered: the seal now holds what was typed.
      this.unopened.delete(id);
      this.setRemembered(id, remember);
      if (remember) {
        this.touch();
      }
    }
  }

  /**
   * Determines whether a connection's secrets are remembered in the document.
   * @param id The connection's id.
   * @returns Returns true when they are.
   */
  public remembers(id: string): boolean {
    return this.rememberedSignal().has(id);
  }

  // --- Passphrase ---

  /**
   * Unlocks the document's passphrase, opening the secrets sealed with it.
   * @param passphrase The passphrase.
   * @returns Returns a promise resolving false when it is wrong.
   */
  public async unlock(passphrase: string): Promise<boolean> {
    const lock: PassphraseLock | null = this.lockSignal();
    if (lock === null) {
      return true;
    }
    const outcome: PassphraseUnlock = await this.client.unlock(passphrase, lock);
    if (outcome.kind === 'wrong') {
      return false;
    }
    this.passphraseHandle.set(outcome.handle);
    await this.openSealed();
    return true;
  }

  /**
   * Gives the document a passphrase, or a new one, so its remembered secrets are sealed with it from
   * the next save. Secrets sealed with the old passphrase and never opened cannot be carried across;
   * they are dropped, and asked for again when next used.
   * @param passphrase The passphrase.
   * @returns Returns a promise resolving false when main could not make the lock.
   */
  public async setPassphrase(passphrase: string): Promise<boolean> {
    const outcome: PassphraseUnlock = await this.client.unlock(passphrase, null);
    if (outcome.kind !== 'unlocked') {
      return false;
    }
    this.forgetPassphrase();
    this.dropUnopened('passphrase');
    this.passphraseHandle.set(outcome.handle);
    this.lockSignal.set(outcome.lock);
    this.log.info('database.workspace', 'Passphrase set');
    this.touch();
    return true;
  }

  /**
   * Removes the document's passphrase, so its remembered secrets are sealed with the machine's key
   * from the next save.
   */
  public removePassphrase(): void {
    if (this.lockSignal() === null) {
      return;
    }
    this.forgetPassphrase();
    this.dropUnopened('passphrase');
    this.lockSignal.set(null);
    this.log.info('database.workspace', 'Passphrase removed');
    this.touch();
  }

  /**
   * Forgets the unlocked passphrase's key in main, for when the tab closes.
   */
  public forgetPassphrase(): void {
    const handle: string | null = this.passphraseHandle();
    if (handle !== null) {
      this.client.forget(handle);
      this.passphraseHandle.set(null);
    }
  }

  /**
   * Opens every seal this session can: machine seals with the keychain, passphrase seals once the
   * passphrase is unlocked. A seal that does not open stays as it was, and its connection asks.
   */
  private async openSealed(): Promise<void> {
    const handle: string | null = this.passphraseHandle();
    await Promise.all(
      [...this.unopened].map(async ([id, sealed]: [string, SealedSecrets]): Promise<void> => {
        if (sealed.scheme === 'passphrase' && handle === null) {
          return;
        }
        const opened: Readonly<Record<string, string>> | null = await this.client.open(
          sealed,
          handle,
        );
        if (opened !== null && this.unopened.get(id) === sealed) {
          this.secrets.set(id, opened);
          this.unopened.delete(id);
        }
      }),
    );
  }

  /**
   * Drops the unopened seals of one scheme, which a change of key has made impossible to open.
   * @param scheme The scheme.
   */
  private dropUnopened(scheme: SealedSecrets['scheme']): void {
    for (const [id, sealed] of [...this.unopened]) {
      if (sealed.scheme === scheme) {
        this.unopened.delete(id);
      }
    }
  }

  /**
   * Records whether a connection's secrets are remembered.
   * @param id The connection's id.
   * @param remember Whether they are.
   */
  private setRemembered(id: string, remember: boolean): void {
    this.rememberedSignal.update((ids: ReadonlySet<string>): ReadonlySet<string> => {
      const next: Set<string> = new Set<string>(ids);
      if (remember) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  /**
   * Opens a connection's session, unless it is open or opening already.
   * @param id The connection's id.
   * @returns Returns a promise resolving true when the connection is open.
   */
  public async connect(id: string): Promise<boolean> {
    if (this.sessionsSignal().has(id)) {
      return true;
    }
    const connection: DatabaseConnection | undefined = this.connection(id);
    if (connection === undefined || this.connectingSignal().has(id)) {
      return false;
    }
    this.connectingSignal.update(
      (ids: ReadonlySet<string>): ReadonlySet<string> => new Set<string>([...ids, id]),
    );
    this.setConnectionError(id, null);
    try {
      const outcome: ConnectOutcome = await this.client.connect(
        connection.engine,
        this.valuesFor(id),
      );
      if (outcome.kind === 'failure') {
        this.setConnectionError(id, outcome.message);
        return false;
      }
      this.sessionsSignal.update(
        (sessions: ReadonlyMap<string, OpenSession>): ReadonlyMap<string, OpenSession> =>
          new Map<string, OpenSession>([
            ...sessions,
            [id, { session: outcome.session, serverVersion: outcome.serverVersion }],
          ]),
      );
      this.log.info('database.workspace', 'Connected', {
        engine: connection.engine,
        server: outcome.serverVersion,
      });
      await this.expand(id, null);
      return true;
    } finally {
      this.connectingSignal.update((ids: ReadonlySet<string>): ReadonlySet<string> => {
        const next: Set<string> = new Set<string>(ids);
        next.delete(id);
        return next;
      });
    }
  }

  /**
   * Closes a connection's session and forgets its tree.
   * @param id The connection's id.
   */
  public async disconnect(id: string): Promise<void> {
    const open: OpenSession | undefined = this.sessionsSignal().get(id);
    this.sessionsSignal.update(
      (sessions: ReadonlyMap<string, OpenSession>): ReadonlyMap<string, OpenSession> => {
        const next: Map<string, OpenSession> = new Map<string, OpenSession>(sessions);
        next.delete(id);
        return next;
      },
    );
    this.childrenSignal.update(
      (children: ReadonlyMap<string, NodeChildren>): ReadonlyMap<string, NodeChildren> => {
        const prefix: string = `${id}\u0000`;
        return new Map<string, NodeChildren>(
          [...children].filter(([key]: [string, NodeChildren]): boolean => !key.startsWith(prefix)),
        );
      },
    );
    if (open !== undefined) {
      await this.client.disconnect(open.session);
    }
  }

  /**
   * Tests a connection's values without keeping a session open.
   * @param engine The engine's id.
   * @param values Every field value, secrets included.
   * @returns Returns a promise resolving the outcome.
   */
  public test(engine: string, values: ConnectionValues): Promise<ConnectOutcome> {
    return this.client.test(engine, values);
  }

  // --- The tree ---

  /**
   * Loads a node's children, unless they are loaded or loading already.
   * @param connectionId The connection.
   * @param path The node's path, or null for the top of the tree.
   */
  public async expand(connectionId: string, path: string | null): Promise<void> {
    const key: string = nodeKey(connectionId, path);
    const current: NodeChildren | undefined = this.childrenSignal().get(key);
    if (current !== undefined && current.state !== 'failed') {
      return;
    }
    await this.loadChildren(connectionId, path);
  }

  /**
   * Reloads a node's children, dropping everything cached beneath it.
   * @param connectionId The connection.
   * @param path The node's path, or null for the whole tree.
   */
  public async refresh(connectionId: string, path: string | null): Promise<void> {
    await this.loadChildren(connectionId, path);
  }

  /**
   * Reads a node's children from the engine.
   * @param connectionId The connection.
   * @param path The node's path, or null for the top of the tree.
   */
  private async loadChildren(connectionId: string, path: string | null): Promise<void> {
    const open: OpenSession | undefined = this.sessionsSignal().get(connectionId);
    if (open === undefined) {
      return;
    }
    const key: string = nodeKey(connectionId, path);
    this.setChildren(key, { state: 'loading' });
    const outcome: ExpandOutcome = await this.client.expand(open.session, path);
    this.setChildren(
      key,
      outcome.kind === 'nodes'
        ? { state: 'loaded', nodes: outcome.nodes }
        : { state: 'failed', message: outcome.message },
    );
  }

  /**
   * Records one node's children.
   * @param key The node's cache key.
   * @param children Its children's state.
   */
  private setChildren(key: string, children: NodeChildren): void {
    this.childrenSignal.update(
      (all: ReadonlyMap<string, NodeChildren>): ReadonlyMap<string, NodeChildren> =>
        new Map<string, NodeChildren>([...all, [key, children]]),
    );
  }

  /**
   * Shows something in the Properties panel.
   * @param selection What to show, or null for nothing.
   */
  public select(selection: DatabaseSelection | null): void {
    this.selectionSignal.set(selection);
  }

  /**
   * Runs a node action: a script opens as a new query, a refresh reloads the node.
   * @param connectionId The connection.
   * @param node The node.
   * @param action The action's id.
   * @returns Returns a promise resolving the query a script opened as, or null.
   */
  public async runAction(
    connectionId: string,
    node: DatabaseNode,
    action: string,
  ): Promise<DatabaseQuery | null> {
    const open: OpenSession | undefined = this.sessionsSignal().get(connectionId);
    if (open === undefined) {
      return null;
    }
    const outcome: NodeActionOutcome = await this.client.action(open.session, node.path, action);
    switch (outcome.kind) {
      case 'script': {
        const query: DatabaseQuery = this.addQuery(
          connectionId,
          outcome.database ?? node.database,
          outcome.text,
          outcome.title,
        );
        // A script that only reads runs as it opens when the user has asked for that; one that would
        // change something is only ever opened.
        if (outcome.reads === true && this.settings.databaseSelectAction() === 'open-and-run') {
          void this.execute(query.id, query.text);
        }
        return query;
      }
      case 'refresh':
        await this.refresh(connectionId, outcome.path);
        return null;
      case 'failure':
        this.log.warn('database.workspace', 'Node action failed', {
          action,
          message: outcome.message,
        });
        return null;
    }
  }

  /**
   * Produces the script a node's action writes, without opening or running it — for the agent, which
   * reads a definition rather than handing the user a new query for it.
   * @param connectionId The connection.
   * @param path The node's path.
   * @param action The action's id.
   * @returns Returns a promise resolving what the action produced.
   */
  public async script(
    connectionId: string,
    path: string,
    action: string,
  ): Promise<NodeActionOutcome> {
    const open: OpenSession | undefined = this.sessionsSignal().get(connectionId);
    if (open === undefined) {
      return { kind: 'failure', message: 'The connection is not open.' };
    }
    return this.client.action(open.session, path, action);
  }

  // --- Queries ---

  /**
   * Gets a query by id.
   * @param id The query's id.
   * @returns Returns the query, or undefined.
   */
  public query(id: string): DatabaseQuery | undefined {
    return this.queriesSignal().find((query: DatabaseQuery): boolean => query.id === id);
  }

  /**
   * Adds a query.
   * @param connectionId The connection it runs against, or null.
   * @param database The database it runs against, when the engine reaches several.
   * @param text Its text.
   * @param title Its title; numbered after the existing queries when omitted.
   * @returns Returns the new query.
   */
  public addQuery(
    connectionId: string | null,
    database: string | undefined,
    text: string = '',
    title?: string,
  ): DatabaseQuery {
    const query: DatabaseQuery = {
      id: newId(),
      title: title ?? `Query ${this.queriesSignal().length + 1}`,
      connectionId,
      ...(database === undefined ? {} : { database }),
      text,
    };
    this.queriesSignal.update((queries: readonly DatabaseQuery[]): readonly DatabaseQuery[] => [
      ...queries,
      query,
    ]);
    this.touch();
    return query;
  }

  /**
   * Applies a change to a query.
   * @param id The query's id.
   * @param changes The fields to change.
   */
  public updateQuery(id: string, changes: Partial<Omit<DatabaseQuery, 'id'>>): void {
    this.queriesSignal.update((queries: readonly DatabaseQuery[]): readonly DatabaseQuery[] =>
      queries.map((query: DatabaseQuery): DatabaseQuery =>
        query.id === id ? { ...query, ...changes } : query,
      ),
    );
    this.touch();
  }

  /**
   * Removes a query.
   * @param id The query's id.
   */
  public removeQuery(id: string): void {
    this.queriesSignal.update((queries: readonly DatabaseQuery[]): readonly DatabaseQuery[] =>
      queries.filter((query: DatabaseQuery): boolean => query.id !== id),
    );
    this.touch();
  }

  /**
   * Gets a query's latest outcome this session.
   * @param id The query's id.
   * @returns Returns the outcome, or null.
   */
  public outcome(id: string): ExecuteOutcome | null {
    return this.outcomesSignal().get(id) ?? null;
  }

  /**
   * Gets every query's latest outcome, for the status strip.
   */
  public readonly outcomes: Signal<ReadonlyMap<string, ExecuteOutcome>> =
    this.outcomesSignal.asReadonly();

  /**
   * Runs a query's text — the whole document or the selection — connecting first if need be.
   * @param id The query's id.
   * @param text The text to run.
   * @param firstLine The document line the text starts on.
   * @returns Returns a promise resolving the outcome, or null when the query cannot run.
   */
  public async execute(
    id: string,
    text: string,
    firstLine: number = 1,
  ): Promise<ExecuteOutcome | null> {
    const query: DatabaseQuery | undefined = this.query(id);
    if (query === undefined || query.connectionId === null || this.runningSignal().has(id)) {
      return null;
    }
    if (!(await this.connect(query.connectionId))) {
      const message: string =
        this.connectionErrorsSignal().get(query.connectionId) ?? 'Could not connect.';
      const failed: ExecuteOutcome = {
        id: newId(),
        resultSets: [],
        messages: [{ severity: 'error', text: message }],
        elapsedMs: 0,
        failed: true,
        cancelled: false,
      };
      this.setOutcome(id, failed);
      return failed;
    }
    const open: OpenSession | undefined = this.sessionsSignal().get(query.connectionId);
    if (open === undefined) {
      return null;
    }
    const executionId: string = newId();
    this.runningSignal.update(
      (running: ReadonlyMap<string, string>): ReadonlyMap<string, string> =>
        new Map<string, string>([...running, [id, executionId]]),
    );
    try {
      const outcome: ExecuteOutcome = await this.client.execute({
        id: executionId,
        session: open.session,
        text,
        firstLine,
        ...(query.database === undefined ? {} : { database: query.database }),
      });
      this.setOutcome(id, outcome);
      return outcome;
    } finally {
      this.runningSignal.update(
        (running: ReadonlyMap<string, string>): ReadonlyMap<string, string> => {
          const next: Map<string, string> = new Map<string, string>(running);
          next.delete(id);
          return next;
        },
      );
    }
  }

  /**
   * Cancels a query's running execution.
   * @param id The query's id.
   */
  public cancel(id: string): void {
    const execution: string | undefined = this.runningSignal().get(id);
    if (execution !== undefined) {
      this.client.cancel(execution);
    }
  }

  /**
   * Fetches the next page of a paged result set into a query's outcome.
   * @param id The query's id.
   * @param resultSetId The result set.
   */
  public async fetchMore(id: string, resultSetId: string): Promise<void> {
    const query: DatabaseQuery | undefined = this.query(id);
    const outcome: ExecuteOutcome | null = this.outcome(id);
    const open: OpenSession | undefined =
      query?.connectionId === null || query === undefined
        ? undefined
        : this.sessionsSignal().get(query.connectionId);
    const resultSet: ResultSet | undefined = outcome?.resultSets.find(
      (set: ResultSet): boolean => set.id === resultSetId,
    );
    if (outcome === null || open === undefined || resultSet === undefined) {
      return;
    }
    const rows: readonly (readonly DatabaseValue[])[] = await this.client.fetch({
      session: open.session,
      resultSet: resultSetId,
      offset: resultSet.rows.length,
      count: FETCH_PAGE_ROWS,
    });
    this.setOutcome(id, {
      ...outcome,
      resultSets: outcome.resultSets.map((set: ResultSet): ResultSet =>
        set.id === resultSetId ? { ...set, rows: [...set.rows, ...rows] } : set,
      ),
    });
  }

  /**
   * Records a query's outcome.
   * @param id The query's id.
   * @param outcome The outcome.
   */
  private setOutcome(id: string, outcome: ExecuteOutcome): void {
    this.outcomesSignal.update(
      (outcomes: ReadonlyMap<string, ExecuteOutcome>): ReadonlyMap<string, ExecuteOutcome> =>
        new Map<string, ExecuteOutcome>([...outcomes, [id, outcome]]),
    );
  }

  /**
   * Closes every session, for when the tab closes.
   */
  public async closeAll(): Promise<void> {
    this.forgetPassphrase();
    await Promise.allSettled(
      [...this.sessionsSignal().keys()].map((id: string): Promise<void> => this.disconnect(id)),
    );
  }

  // --- Helpers ---

  /**
   * Records an edit.
   */
  private touch(): void {
    this.dirtySignal.set(true);
  }

  /**
   * Records or clears why a connection failed.
   * @param id The connection's id.
   * @param message The reason, or null to clear it.
   */
  private setConnectionError(id: string, message: string | null): void {
    this.connectionErrorsSignal.update(
      (errors: ReadonlyMap<string, string>): ReadonlyMap<string, string> => {
        const next: Map<string, string> = new Map<string, string>(errors);
        if (message === null) {
          next.delete(id);
        } else {
          next.set(id, message);
        }
        return next;
      },
    );
  }

  /**
   * Keeps only the values of an engine's non-secret fields.
   * @param engine The engine's id.
   * @param values Every value.
   * @returns Returns the values that may be saved.
   */
  private publicValues(engine: string, values: ConnectionValues): ConnectionValues {
    const secret: ReadonlySet<string> = this.secretIds(engine);
    return Object.fromEntries(
      Object.entries(values).filter(([key]: [string, string]): boolean => !secret.has(key)),
    );
  }

  /**
   * Keeps only the values of an engine's secret fields.
   * @param engine The engine's id.
   * @param values Every value.
   * @returns Returns the secret values.
   */
  private secretValues(engine: string, values: ConnectionValues): Readonly<Record<string, string>> {
    const secret: ReadonlySet<string> = this.secretIds(engine);
    return Object.fromEntries(
      Object.entries(values).filter(([key]: [string, string]): boolean => secret.has(key)),
    );
  }

  /**
   * Lists an engine's secret field ids.
   * @param engine The engine's id.
   * @returns Returns the ids.
   */
  private secretIds(engine: string): ReadonlySet<string> {
    return new Set<string>(
      (this.engine(engine)?.connectionFields ?? [])
        .filter((field) => field.secret === true)
        .map((field) => field.id),
    );
  }
}
