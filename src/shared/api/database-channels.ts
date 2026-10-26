import { PassphraseLock } from './database-document';

/**
 * Names the Database Explorer's IPC channels: the renderer's client and the main-process
 * {@link import('../electron/contributions/database/database.contribution').DatabaseContribution}
 * name theirs from here.
 *
 * Each channel is one request of the {@link import('./database-engine-protocol')} protocol: main
 * forwards it to the engine plugin the session belongs to, and answers with what the plugin said.
 */
export enum DatabaseChannel {
  /**
   * Lists the installed engines, as their `initialize` answers (invoke). Starting each installed
   * engine's plugin is what answering takes, so it is asked when a Database Explorer opens, not before.
   */
  Engines = 'database:engines',

  /**
   * Opens a connection and resolves a session, or why there is none (invoke).
   */
  Connect = 'database:connect',

  /**
   * Opens a connection, reports whether it worked, and closes it again (invoke).
   */
  Test = 'database:test',

  /**
   * Closes a session (invoke).
   */
  Disconnect = 'database:disconnect',

  /**
   * Lists a tree node's children; a null path lists the top of the tree (invoke).
   */
  Expand = 'database:expand',

  /**
   * Runs text and resolves its outcome (invoke). Never rejects.
   */
  Execute = 'database:execute',

  /**
   * Cancels a running execution by its identifier (send).
   */
  Cancel = 'database:cancel',

  /**
   * Reads more rows of a paged result set (invoke).
   */
  Fetch = 'database:fetch',

  /**
   * Runs a node action and resolves what it produced (invoke).
   */
  Action = 'database:action',

  /**
   * Lists names to complete a query with (invoke): a session's objects, or one object's members. An
   * engine without the `completion` capability answers with none.
   */
  Names = 'database:names',

  /**
   * Reports whether this machine can seal secrets with its keychain (invoke). Without one, a secret is
   * remembered only in a document with a passphrase.
   */
  SecretsMachineSealing = 'database:secrets-machine-sealing',

  /**
   * Unlocks a passphrase (invoke): checks it against a document's lock, or makes a new lock when there
   * is none, and resolves a {@link PassphraseUnlock}. The key stays in main; the renderer holds only
   * its handle.
   */
  SecretsUnlock = 'database:secrets-unlock',

  /**
   * Seals a connection's secrets (invoke), with the passphrase behind a handle or, with none, with the
   * machine's keychain. Resolves the seal, or null when the machine cannot seal.
   */
  SecretsSeal = 'database:secrets-seal',

  /**
   * Opens a seal (invoke), resolving the secrets, or null when this machine or handle cannot.
   */
  SecretsOpen = 'database:secrets-open',

  /**
   * Forgets a passphrase handle's key (send), when its document closes or its passphrase changes.
   */
  SecretsForget = 'database:secrets-forget',
}

/**
 * What unlocking a passphrase resolves.
 */
export type PassphraseUnlock =
  | { readonly kind: 'unlocked'; readonly handle: string; readonly lock: PassphraseLock }
  | { readonly kind: 'wrong' };
