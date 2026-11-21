// The live-server protocol shared between the Electron main process and a live-server plugin (#1062).
// Keep this module platform-neutral (no Node or DOM dependencies) so both compilation targets can
// import it.
//
// A live server is a plugin like every other seam: core draws Open with Live Server and the status
// chip, and the plugin serves a folder's files over HTTP and reloads the pages it served when those
// files change. ⛔ Core runs no web server of its own.
//
// The transport is newline-delimited JSON over standard streams, as for the test adapters: one request
// per line in, one response per line out, correlated by `id`.
//
// Decisions this protocol carries (taken on Matthew's behalf, 2026-11-21, #1062):
// - **Studio names the folder; the plugin confines itself to it.** Core checks the folder is an open
//   workspace before asking, and the plugin refuses any request whose path, once decoded and its links
//   followed, leaves it.
// - **127.0.0.1 only.** The plugin binds the loopback address and nothing else, and answers only
//   requests addressed to it by that name or `localhost`, so a page elsewhere cannot rebind a host name
//   onto it.
// - **The plugin watches what it serves.** The workspace watcher reports changed folders, not files,
//   and telling a stylesheet's change from a page's is what lets CSS restyle without a reload.

/**
 * Holds the protocol version this build speaks. A plugin announcing a different major version is
 * refused rather than spoken to.
 */
export const LIVE_SERVER_PROTOCOL_VERSION: string = '1.0';

/**
 * Describes what a plugin said it is, in answer to `initialize`.
 */
export interface LiveServerDescription {
  /**
   * Gets the protocol version the plugin speaks.
   */
  readonly protocol: string;
}

/**
 * Describes a folder the plugin has started serving, in answer to `serve`.
 */
export interface LiveServerServing {
  /**
   * Gets the identifier the plugin knows the server by, which `stop` names.
   */
  readonly serverId: string;

  /**
   * Gets the port it listens on, on 127.0.0.1.
   */
  readonly port: number;
}

/**
 * Describes every operation: its parameters and its result.
 */
export interface LiveServerOperations {
  /**
   * Completes the handshake. Sent once, first.
   */
  initialize: {
    readonly params: {
      /**
       * Gets the protocol version Studio speaks.
       */
      readonly protocol: string;
    };
    readonly result: LiveServerDescription;
  };

  /**
   * Starts serving a folder on the first free port from the one asked for.
   */
  serve: {
    readonly params: {
      /**
       * Gets the absolute folder to serve, its links already followed.
       */
      readonly root: string;

      /**
       * Gets the port to try first.
       */
      readonly port: number;
    };
    readonly result: LiveServerServing;
  };

  /**
   * Stops serving, closing the port and every page's connection.
   */
  stop: {
    readonly params: {
      /**
       * Gets the server to stop.
       */
      readonly serverId: string;
    };
    readonly result: Readonly<Record<string, never>>;
  };
}

/**
 * Names an operation.
 */
export type LiveServerOp = keyof LiveServerOperations;

/**
 * Gets an operation's parameters.
 */
export type LiveServerParams<Op extends LiveServerOp> = LiveServerOperations[Op]['params'];

/**
 * Gets an operation's result.
 */
export type LiveServerResult<Op extends LiveServerOp> = LiveServerOperations[Op]['result'];

/**
 * Describes a request sent to a plugin.
 */
export interface LiveServerRequest<Op extends LiveServerOp = LiveServerOp> {
  /**
   * Gets the request correlation identifier.
   */
  readonly id: number;

  /**
   * Gets the operation requested.
   */
  readonly op: Op;

  /**
   * Gets the operation's parameters.
   */
  readonly params: LiveServerParams<Op>;
}

/**
 * Describes a plugin's answer to a request: the result on success, or the reason it failed.
 */
export type LiveServerResponse<Op extends LiveServerOp = LiveServerOp> =
  | {
      /**
       * Gets the correlation identifier of the request this answers.
       */
      readonly id: number;

      /**
       * Discriminates the success case.
       */
      readonly ok: true;

      /**
       * Gets the operation's result.
       */
      readonly result: LiveServerResult<Op>;
    }
  | {
      /**
       * Gets the correlation identifier of the request this answers.
       */
      readonly id: number;

      /**
       * Discriminates the failure case.
       */
      readonly ok: false;

      /**
       * Gets the reason, in the user's terms.
       */
      readonly error: string;

      /**
       * Gets whether Studio stopped waiting rather than the plugin answering: what was asked may still
       * happen after the caller has given up on it. Set by Studio's client, never by a plugin.
       */
      readonly timedOut?: boolean;
    };

/**
 * Determines whether a plugin's announced protocol version is one this build can speak: the same major
 * version. A newer minor only adds things, which a plugin may use and this build ignores.
 * @param announced The version the plugin announced.
 * @returns Returns true when the version can be spoken.
 */
export function isCompatibleLiveServerProtocol(announced: unknown): boolean {
  if (typeof announced !== 'string' || !/^\d+(\.\d+)*$/.test(announced)) {
    return false;
  }
  const major: (version: string) => string = (version: string): string => version.split('.')[0];
  return major(announced) === major(LIVE_SERVER_PROTOCOL_VERSION);
}
