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
}
