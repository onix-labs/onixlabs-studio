import { beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import { ConnectionValues, DatabaseEngineInfo } from '@shared/api/database-engine-protocol';
import { DatabaseConnection } from '@shared/api/database-document';
import { DatabaseWorkspace } from '../database-workspace/database-workspace';
import { DatabasePrompts } from './database-prompts';

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
