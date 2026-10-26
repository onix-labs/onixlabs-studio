import { computed, inject, Service, Signal, signal, WritableSignal } from '@angular/core';
import {
  ConnectionField,
  ConnectOutcome,
  DatabaseEngineInfo,
} from '@shared/api/database-engine-protocol';
import { DatabaseConnection } from '@shared/api/database-document';
import { DatabaseWorkspace } from '../database-workspace/database-workspace';

/**
 * What the connection dialog is doing: adding a connection, editing one, or asking for the secrets a
 * saved one needs before it can connect.
 */
export type ConnectionDialogMode = 'new' | 'edit' | 'secrets';

/**
 * The state of the dialog's Test button.
 */
export type ConnectionTestState =
  | { readonly state: 'idle' }
  | { readonly state: 'testing' }
  | { readonly state: 'passed'; readonly serverVersion: string }
  | { readonly state: 'failed'; readonly message: string };

/**
 * The connection dialog's model, held by the view so the ribbon, the explorer panel's menu and the
 * tree's Connect all raise the same dialog.
 *
 * The fields it shows are the chosen engine's own, as the engine described them: Studio renders them
 * with its form atoms, and the engine never draws anything.
 */
@Service()
export class DatabasePrompts {
  private readonly workspace: DatabaseWorkspace = inject(DatabaseWorkspace);

  /**
   * Holds what the dialog is doing, or null while it is closed.
   */
  public readonly mode: WritableSignal<ConnectionDialogMode | null> =
    signal<ConnectionDialogMode | null>(null);

  /**
   * Holds the connection being edited or connected, or null for a new one.
   */
  public readonly connectionId: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds the chosen engine's id.
   */
  public readonly engineId: WritableSignal<string> = signal<string>('');

  /**
   * Holds the connection's name.
   */
  public readonly name: WritableSignal<string> = signal<string>('');

  /**
   * Holds the field values being entered.
   */
  public readonly values: WritableSignal<Readonly<Record<string, string>>> = signal<
    Readonly<Record<string, string>>
  >({});

  /**
   * Holds the Test button's state.
   */
  public readonly test: WritableSignal<ConnectionTestState> = signal<ConnectionTestState>({
    state: 'idle',
  });

  /**
   * Gets the chosen engine.
   */
  public readonly engine: Signal<DatabaseEngineInfo | undefined> = computed(
    (): DatabaseEngineInfo | undefined =>
      this.workspace
        .engines()
        .find((engine: DatabaseEngineInfo): boolean => engine.id === this.engineId()),
  );

  /**
   * Gets the fields the dialog shows: every field, or only the secrets when that is all it is asking.
   */
  public readonly fields: Signal<readonly ConnectionField[]> = computed(
    (): readonly ConnectionField[] => {
      const fields: readonly ConnectionField[] = this.engine()?.connectionFields ?? [];
      return this.mode() === 'secrets'
        ? fields.filter((field: ConnectionField): boolean => field.secret === true)
        : fields;
    },
  );

  /**
   * Gets whether every required field has a value.
   */
  public readonly complete: Signal<boolean> = computed((): boolean => {
    const values: Readonly<Record<string, string>> = this.values();
    return (
      this.name().trim() !== '' &&
      (this.engine()?.connectionFields ?? []).every(
        (field: ConnectionField): boolean =>
          field.required !== true || (values[field.id] ?? '').trim() !== '',
      )
    );
  });

  /**
   * Called with the connection's id once the secrets dialog is confirmed, to carry on with whatever
   * asked for them.
   */
  private afterSecrets: ((id: string) => void) | null = null;

  /**
   * Opens the dialog for a new connection, with the first engine chosen.
   */
  public newConnection(): void {
    const first: DatabaseEngineInfo | undefined = this.workspace.engines()[0];
    this.connectionId.set(null);
    this.name.set('');
    this.chooseEngine(first?.id ?? '');
    this.mode.set('new');
  }

  /**
   * Opens the dialog to edit a saved connection.
   * @param id The connection's id.
   */
  public editConnection(id: string): void {
    const connection: DatabaseConnection | undefined = this.workspace.connection(id);
    if (connection === undefined) {
      return;
    }
    this.connectionId.set(id);
    this.engineId.set(connection.engine);
    this.name.set(connection.name);
    this.values.set({ ...this.defaults(connection.engine), ...this.workspace.valuesFor(id) });
    this.test.set({ state: 'idle' });
    this.mode.set('edit');
  }

  /**
   * Opens the dialog to ask for a connection's secrets, then carries on.
   * @param id The connection's id.
   * @param then What to do once they are entered.
   */
  public askSecrets(id: string, then: (id: string) => void): void {
    const connection: DatabaseConnection | undefined = this.workspace.connection(id);
    if (connection === undefined) {
      return;
    }
    this.connectionId.set(id);
    this.engineId.set(connection.engine);
    this.name.set(connection.name);
    this.values.set({ ...this.defaults(connection.engine), ...this.workspace.valuesFor(id) });
    this.test.set({ state: 'idle' });
    this.afterSecrets = then;
    this.mode.set('secrets');
  }

  /**
   * Connects a saved connection, asking for its secrets first when this session has none.
   * @param id The connection's id.
   */
  public connect(id: string): void {
    if (this.workspace.needsSecrets(id)) {
      this.askSecrets(id, (ready: string): void => void this.workspace.connect(ready));
      return;
    }
    void this.workspace.connect(id);
  }

  /**
   * Switches the dialog to another engine, resetting the fields to that engine's defaults.
   * @param id The engine's id.
   */
  public chooseEngine(id: string): void {
    this.engineId.set(id);
    this.values.set(this.defaults(id));
    this.test.set({ state: 'idle' });
    if (
      this.name().trim() === '' ||
      this.workspace
        .engines()
        .some((engine: DatabaseEngineInfo): boolean => engine.displayName === this.name())
    ) {
      this.name.set(this.engine()?.displayName ?? '');
    }
  }

  /**
   * Sets one field's value.
   * @param id The field's id.
   * @param value The value.
   */
  public setValue(id: string, value: string): void {
    this.values.update(
      (values: Readonly<Record<string, string>>): Readonly<Record<string, string>> => ({
        ...values,
        [id]: value,
      }),
    );
    this.test.set({ state: 'idle' });
  }

  /**
   * Tests the values entered.
   */
  public async runTest(): Promise<void> {
    this.test.set({ state: 'testing' });
    const outcome: ConnectOutcome = await this.workspace.test(this.engineId(), this.values());
    this.test.set(
      outcome.kind === 'connected'
        ? { state: 'passed', serverVersion: outcome.serverVersion }
        : { state: 'failed', message: outcome.message },
    );
  }

  /**
   * Applies the dialog: adds the connection, saves its edits, or holds the secrets and carries on.
   * @returns Returns the connection's id, or null when nothing was applied.
   */
  public async confirm(): Promise<string | null> {
    const mode: ConnectionDialogMode | null = this.mode();
    const id: string | null = this.connectionId();
    this.mode.set(null);
    switch (mode) {
      case 'new':
        return this.workspace.addConnection(this.name().trim(), this.engineId(), this.values()).id;
      case 'edit':
        if (id !== null) {
          await this.workspace.updateConnection(id, this.name().trim(), this.values());
        }
        return id;
      case 'secrets': {
        const then: ((id: string) => void) | null = this.afterSecrets;
        this.afterSecrets = null;
        if (id !== null) {
          this.workspace.provideSecrets(id, this.values());
          then?.(id);
        }
        return id;
      }
      default:
        return null;
    }
  }

  /**
   * Closes the dialog without applying it.
   */
  public cancel(): void {
    this.afterSecrets = null;
    this.mode.set(null);
  }

  /**
   * Gets an engine's default field values.
   * @param id The engine's id.
   * @returns Returns the defaults.
   */
  private defaults(id: string): Readonly<Record<string, string>> {
    const engine: DatabaseEngineInfo | undefined = this.workspace
      .engines()
      .find((candidate: DatabaseEngineInfo): boolean => candidate.id === id);
    return Object.fromEntries(
      (engine?.connectionFields ?? []).map((field: ConnectionField): [string, string] => [
        field.id,
        field.defaultValue ?? '',
      ]),
    );
  }
}
