import { beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import {
  ConnectionField,
  ConnectionValues,
  DatabaseEngineInfo,
} from '@shared/api/database-engine-protocol';
import { DatabaseConnection } from '@shared/api/database-document';
import { DatabaseWorkspace } from '../database-workspace/database-workspace';
import {
  ConnectionDialogTab,
  ConnectionFieldGroup,
  DatabasePrompts,
  layoutConnectionFields,
} from './database-prompts';

/**
 * An engine with a secret password field.
 */
const POSTGRES: DatabaseEngineInfo = {
  id: 'postgres',
  displayName: 'PostgreSQL',
  language: 'pgsql',
  queryExtension: 'sql',
  capabilities: [],
  connectionFields: [
    { id: 'host', label: 'Host', kind: 'text' },
    { id: 'password', label: 'Password', kind: 'password', secret: true },
  ],
};

/**
 * An engine with required fields on both tabs.
 */
const TABBED: DatabaseEngineInfo = {
  id: 'tabbed',
  displayName: 'Tabbed',
  language: 'sql',
  queryExtension: 'sql',
  capabilities: [],
  connectionFields: [
    { id: 'host', label: 'Host', kind: 'text', required: true, section: 'server' },
    { id: 'port', label: 'Port', kind: 'number', required: true, section: 'server', inline: true },
    { id: 'database', label: 'Database', kind: 'text', required: true, section: 'database' },
    { id: 'ssl', label: 'Encryption', kind: 'choice', section: 'security' },
  ],
};

/**
 * Builds a field.
 * @param id The field's id.
 * @param extra The rest of it.
 * @returns Returns the field.
 */
function field(id: string, extra: Partial<ConnectionField> = {}): ConnectionField {
  return { id, label: id, kind: 'text', ...extra };
}

/**
 * Reads a layout as ids: each tab's sections, each section's rows as `field` or `field+beside`.
 * @param groups The tab's sections.
 * @returns Returns the sections and their rows.
 */
function shape(groups: readonly ConnectionFieldGroup[]): readonly [string, readonly string[]][] {
  return groups.map((group: ConnectionFieldGroup): [string, readonly string[]] => [
    group.section,
    group.rows.map((row: { field: ConnectionField; beside?: ConnectionField }): string =>
      row.beside === undefined ? row.field.id : `${row.field.id}+${row.beside.id}`,
    ),
  ]);
}

/**
 * The saved connection the dialog edits.
 */
const SAVED: DatabaseConnection = {
  id: 'c1',
  name: 'Prod',
  engine: 'postgres',
  values: { host: 'h' },
};

/**
 * A stand-in for the workspace, recording what the prompts applied.
 */
class FakeWorkspace {
  /**
   * Gets the engines.
   */
  public readonly engines: WritableSignal<readonly DatabaseEngineInfo[]> = signal<
    readonly DatabaseEngineInfo[]
  >([POSTGRES]);

  /**
   * Gets whether the document has a passphrase not yet unlocked.
   */
  public readonly locked: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the connections whose secrets are remembered.
   */
  public readonly remembered: Set<string> = new Set<string>();

  /**
   * Holds the connections that need their secrets.
   */
  public readonly needing: Set<string> = new Set<string>();

  /**
   * Holds every addConnection call's remember flag.
   */
  public readonly adds: boolean[] = [];

  /**
   * Holds every updateConnection call's remember flag.
   */
  public readonly updates: boolean[] = [];

  /**
   * Holds every provideSecrets call's remember flag.
   */
  public readonly provides: (boolean | undefined)[] = [];

  /**
   * Holds every passphrase set.
   */
  public readonly passphrasesSet: string[] = [];

  /**
   * Holds every passphrase tried.
   */
  public readonly unlocks: string[] = [];

  /**
   * Holds the passphrase that unlocks the document.
   */
  public rightPassphrase: string = 'open sesame';

  /**
   * Finds a connection.
   * @param id The id.
   * @returns Returns the saved connection for its id.
   */
  public connection(id: string): DatabaseConnection | undefined {
    return id === SAVED.id ? SAVED : undefined;
  }

  /**
   * Gets a connection's values.
   * @returns Returns the saved values.
   */
  public valuesFor(): ConnectionValues {
    return SAVED.values;
  }

  /**
   * Determines whether a connection is remembered.
   * @param id The id.
   * @returns Returns true when it is.
   */
  public remembers(id: string): boolean {
    return this.remembered.has(id);
  }

  /**
   * Determines whether a connection needs its secrets.
   * @param id The id.
   * @returns Returns true when it does.
   */
  public needsSecrets(id: string): boolean {
    return this.needing.has(id);
  }

  /**
   * Records an add.
   * @param _name The name.
   * @param _engine The engine.
   * @param _values The values.
   * @param remember Whether to remember.
   * @returns Returns the connection.
   */
  public addConnection(
    _name: string,
    _engine: string,
    _values: ConnectionValues,
    remember: boolean,
  ): DatabaseConnection {
    this.adds.push(remember);
    return { ...SAVED, id: 'new' };
  }

  /**
   * Records an update.
   * @param _id The id.
   * @param _name The name.
   * @param _values The values.
   * @param remember Whether to remember.
   * @returns Returns once recorded.
   */
  public updateConnection(
    _id: string,
    _name: string,
    _values: ConnectionValues,
    remember: boolean,
  ): Promise<void> {
    this.updates.push(remember);
    return Promise.resolve();
  }

  /**
   * Records provided secrets.
   * @param _id The id.
   * @param _values The values.
   * @param remember Whether to remember.
   */
  public provideSecrets(_id: string, _values: ConnectionValues, remember?: boolean): void {
    this.provides.push(remember);
  }

  /**
   * Records a passphrase set.
   * @param passphrase The passphrase.
   * @returns Returns whether main could make the lock.
   */
  public setPassphrase(passphrase: string): Promise<boolean> {
    this.passphrasesSet.push(passphrase);
    return Promise.resolve(this.canSetPassphrase);
  }

  /**
   * Holds whether main can make a passphrase lock.
   */
  public canSetPassphrase: boolean = true;

  /**
   * Records an unlock.
   * @param passphrase The passphrase.
   * @returns Returns true for the right passphrase.
   */
  public unlock(passphrase: string): Promise<boolean> {
    this.unlocks.push(passphrase);
    return Promise.resolve(passphrase === this.rightPassphrase);
  }
}

describe('DatabasePrompts', () => {
  let prompts: DatabasePrompts;
  let workspace: FakeWorkspace;

  beforeEach(() => {
    workspace = new FakeWorkspace();
    TestBed.configureTestingModule({
      providers: [DatabasePrompts, { provide: DatabaseWorkspace, useValue: workspace }],
    });
    prompts = TestBed.inject(DatabasePrompts);
  });

  // --- Remember ---

  it('newConnection_remembersByDefault', () => {
    prompts.remember.set(false);

    prompts.newConnection();

    expect(prompts.remember()).toBe(true);
  });

  it('editConnection_reflectsWhetherTheWorkspaceRemembers', () => {
    prompts.editConnection('c1');
    expect(prompts.remember()).toBe(false);

    workspace.remembered.add('c1');
    prompts.editConnection('c1');
    expect(prompts.remember()).toBe(true);
  });

  it('editConnection_whoseSecretsAreStillNeeded_remembers', () => {
    // A remembered seal this session could not open still counts as remembered.
    workspace.needing.add('c1');

    prompts.editConnection('c1');

    expect(prompts.remember()).toBe(true);
  });

  it('confirm_new_passesRememberThrough', async () => {
    prompts.newConnection();
    prompts.remember.set(false);

    await prompts.confirm();

    expect(workspace.adds).toEqual([false]);
  });

  it('confirm_edit_passesRememberThrough', async () => {
    workspace.remembered.add('c1');
    prompts.editConnection('c1');

    await prompts.confirm();

    expect(workspace.updates).toEqual([true]);
  });

  it('confirm_secrets_passesRememberThroughAndCarriesOn', async () => {
    const carried: string[] = [];
    prompts.askSecrets('c1', (id: string): void => {
      carried.push(id);
    });
    expect(prompts.remember()).toBe(true);
    prompts.remember.set(false);

    await prompts.confirm();

    expect(workspace.provides).toEqual([false]);
    expect(carried).toEqual(['c1']);
  });

  // --- Tabs ---

  it('newConnection_returnsToLogin', () => {
    prompts.tab.set('properties');

    prompts.newConnection();

    expect(prompts.tab()).toBe('login');
  });

  it('editConnection_returnsToLogin', () => {
    prompts.tab.set('properties');

    prompts.editConnection('c1');

    expect(prompts.tab()).toBe('login');
  });

  it('chooseEngine_returnsToLogin_soATabTheNewEngineLacksIsNeverLeftShowing', () => {
    prompts.newConnection();
    prompts.tab.set('properties');

    prompts.chooseEngine('sqlite');

    expect(prompts.tab()).toBe('login');
  });

  it('layout_followsTheChosenEngine', () => {
    workspace.engines.set([TABBED]);

    prompts.newConnection();

    expect(shape(prompts.layout().login)).toEqual([['server', ['host+port']]]);
    expect(shape(prompts.layout().properties)).toEqual([
      ['database', ['database']],
      ['security', ['ssl']],
    ]);
  });

  it('incompleteTabs_namesEachTabWithAnEmptyRequiredField', () => {
    workspace.engines.set([TABBED]);
    prompts.newConnection();

    expect([...prompts.incompleteTabs()]).toEqual<ConnectionDialogTab[]>(['login', 'properties']);
  });

  it('incompleteTabs_countsAFieldBesideAnother', () => {
    workspace.engines.set([TABBED]);
    prompts.newConnection();
    prompts.setValue('host', 'localhost');
    prompts.setValue('database', 'sales');

    expect([...prompts.incompleteTabs()]).toEqual<ConnectionDialogTab[]>(['login']);
  });

  it('incompleteTabs_treatsBlankAsEmpty_andIsEmptyOnceAllAreFilled', () => {
    workspace.engines.set([TABBED]);
    prompts.newConnection();
    prompts.setValue('host', 'localhost');
    prompts.setValue('port', '5432');
    prompts.setValue('database', '   ');

    expect([...prompts.incompleteTabs()]).toEqual<ConnectionDialogTab[]>(['properties']);

    prompts.setValue('database', 'sales');

    expect(prompts.incompleteTabs().size).toBe(0);
  });

  // --- Passphrase ---

  it('askNewPassphrase_opensTheSetPromptEmpty', () => {
    prompts.passphrase.set('left over');

    prompts.askNewPassphrase();

    expect(prompts.passphraseMode()).toBe('set');
    expect(prompts.passphrase()).toBe('');
    expect(prompts.passphraseConfirm()).toBe('');
    expect(prompts.passphraseError()).toBeNull();
  });

  it('confirmPassphrase_setWithAMismatchedConfirmation_showsAnErrorAndSetsNothing', async () => {
    prompts.askNewPassphrase();
    prompts.passphrase.set('one');
    prompts.passphraseConfirm.set('two');

    await prompts.confirmPassphrase();

    expect(prompts.passphraseError()).not.toBeNull();
    expect(prompts.passphraseMode()).toBe('set');
    expect(workspace.passphrasesSet).toEqual([]);
  });

  it('confirmPassphrase_setWhenTheyAgree_setsItAndCloses', async () => {
    prompts.askNewPassphrase();
    prompts.passphrase.set('open sesame');
    prompts.passphraseConfirm.set('open sesame');

    await prompts.confirmPassphrase();

    expect(workspace.passphrasesSet).toEqual(['open sesame']);
    expect(prompts.passphraseMode()).toBeNull();
    expect(prompts.passphrase()).toBe('');
  });

  it('confirmPassphrase_setThatMainRefuses_showsAnErrorAndStaysOpen', async () => {
    workspace.canSetPassphrase = false;
    prompts.askNewPassphrase();
    prompts.passphrase.set('open sesame');
    prompts.passphraseConfirm.set('open sesame');

    await prompts.confirmPassphrase();

    expect(prompts.passphraseMode()).toBe('set');
    expect(prompts.passphraseError()).toBe('The passphrase could not be set.');
  });

  it('askUnlock_forAnUnlockedOrUnprotectedDocument_doesNothing', () => {
    prompts.askUnlock();

    expect(prompts.passphraseMode()).toBeNull();
  });

  it('confirmPassphrase_unlockWrong_showsAnErrorAndStaysOpen', async () => {
    workspace.locked.set(true);
    prompts.askUnlock();
    expect(prompts.passphraseMode()).toBe('unlock');
    prompts.passphrase.set('wrong');

    await prompts.confirmPassphrase();

    expect(workspace.unlocks).toEqual(['wrong']);
    expect(prompts.passphraseError()).not.toBeNull();
    expect(prompts.passphraseMode()).toBe('unlock');
  });

  it('confirmPassphrase_unlockRight_closes', async () => {
    workspace.locked.set(true);
    prompts.askUnlock();
    prompts.passphrase.set('open sesame');

    await prompts.confirmPassphrase();

    expect(workspace.unlocks).toEqual(['open sesame']);
    expect(prompts.passphraseMode()).toBeNull();
    expect(prompts.passphraseError()).toBeNull();
  });

  it('closePassphrase_clearsWhatWasTyped', () => {
    prompts.askNewPassphrase();
    prompts.passphrase.set('a');
    prompts.passphraseConfirm.set('b');

    prompts.closePassphrase();

    expect(prompts.passphraseMode()).toBeNull();
    expect(prompts.passphrase()).toBe('');
    expect(prompts.passphraseConfirm()).toBe('');
  });
});

describe('layoutConnectionFields', () => {
  it('putsServerAndAuthenticationOnLogin_andTheRestOnProperties_inSectionOrder', () => {
    const layout: Readonly<Record<ConnectionDialogTab, readonly ConnectionFieldGroup[]>> =
      layoutConnectionFields([
        field('mode', { section: 'options' }),
        field('cert', { section: 'security' }),
        field('db', { section: 'database' }),
        field('user', { section: 'authentication' }),
        field('host', { section: 'server' }),
      ]);

    expect(shape(layout.login)).toEqual([
      ['server', ['host']],
      ['authentication', ['user']],
    ]);
    expect(shape(layout.properties)).toEqual([
      ['database', ['db']],
      ['security', ['cert']],
      ['options', ['mode']],
    ]);
  });

  it('keepsTheEnginesOrderWithinASection', () => {
    const layout: Readonly<Record<ConnectionDialogTab, readonly ConnectionFieldGroup[]>> =
      layoutConnectionFields([
        field('password', { section: 'authentication' }),
        field('user', { section: 'authentication' }),
      ]);

    expect(shape(layout.login)).toEqual([['authentication', ['password', 'user']]]);
  });

  it('putsAnUntaggedField_inTheServerSectionOnLogin', () => {
    const layout: Readonly<Record<ConnectionDialogTab, readonly ConnectionFieldGroup[]>> =
      layoutConnectionFields([
        field('user', { section: 'authentication' }),
        field('file'),
        field('host', { section: 'server' }),
      ]);

    expect(shape(layout.login)).toEqual([
      ['server', ['file', 'host']],
      ['authentication', ['user']],
    ]);
    expect(layout.properties).toEqual([]);
  });

  it('putsAnInlineField_besideThePreviousOneInItsSection', () => {
    const layout: Readonly<Record<ConnectionDialogTab, readonly ConnectionFieldGroup[]>> =
      layoutConnectionFields([
        field('host', { section: 'server' }),
        field('port', { section: 'server', inline: true }),
      ]);

    expect(shape(layout.login)).toEqual([['server', ['host+port']]]);
    expect(layout.login[0].rows[0].field.id).toBe('host');
    expect(layout.login[0].rows[0].beside?.id).toBe('port');
  });

  it('neverPutsAnInlineField_besideOneFromAnotherSection', () => {
    const layout: Readonly<Record<ConnectionDialogTab, readonly ConnectionFieldGroup[]>> =
      layoutConnectionFields([
        field('host', { section: 'server' }),
        field('user', { section: 'authentication', inline: true }),
      ]);

    expect(shape(layout.login)).toEqual([
      ['server', ['host']],
      ['authentication', ['user']],
    ]);
  });

  it('leavesAnInlineFieldAlone_afterARowThatAlreadyHasOneBeside', () => {
    const layout: Readonly<Record<ConnectionDialogTab, readonly ConnectionFieldGroup[]>> =
      layoutConnectionFields([
        field('host', { section: 'server' }),
        field('port', { section: 'server', inline: true }),
        field('socket', { section: 'server', inline: true }),
        field('timeout', { section: 'server', inline: true }),
      ]);

    expect(shape(layout.login)).toEqual([['server', ['host+port', 'socket+timeout']]]);
  });

  it('pairsAcrossAFieldOfAnotherSection_whenBothAreInTheSameSection', () => {
    // Sections gather their fields first, so an inline field pairs with the previous field of its
    // own section even when the engine listed another section's field between them.
    const layout: Readonly<Record<ConnectionDialogTab, readonly ConnectionFieldGroup[]>> =
      layoutConnectionFields([
        field('host', { section: 'server' }),
        field('user', { section: 'authentication' }),
        field('port', { section: 'server', inline: true }),
      ]);

    expect(shape(layout.login)).toEqual([
      ['server', ['host+port']],
      ['authentication', ['user']],
    ]);
  });

  it('leavesAnInlineFieldThatOpensItsSection_onItsOwnRow', () => {
    const layout: Readonly<Record<ConnectionDialogTab, readonly ConnectionFieldGroup[]>> =
      layoutConnectionFields([field('db', { section: 'database', inline: true })]);

    expect(shape(layout.properties)).toEqual([['database', ['db']]]);
  });

  it('leavesOutEmptySections_andAnswersEmptyTabsForNoFields', () => {
    expect(layoutConnectionFields([])).toEqual({ login: [], properties: [] });
    expect(
      shape(layoutConnectionFields([field('ssl', { section: 'security' })]).properties),
    ).toEqual([['security', ['ssl']]]);
  });
});
