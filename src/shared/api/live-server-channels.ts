/**
 * Names the live-server IPC channels (#1062): what the explorers and the status chip ask the main
 * process's live-server host, and what it tells them back. Every folder is checked by the host — an
 * open workspace, a page inside it — before any plugin hears of it.
 */
export enum LiveServerChannel {
  /**
   * Says whether a live server can be offered at all, so the explorers draw Open with Live Server only
   * when there is a plugin behind it (invoke).
   */
  Availability = 'live-server:availability',

  /**
   * Serves the workspace a page lies in, starting its server when none runs, and answers with the
   * page's address (invoke).
   */
  Open = 'live-server:open',

  /**
   * Stops the server of a workspace, freeing its port (invoke).
   */
  Stop = 'live-server:stop',

  /**
   * Lists the running servers (invoke).
   */
  List = 'live-server:list',

  /**
   * Tells every window the running servers changed, with the new list (main→renderer, send).
   */
  Changed = 'live-server:changed',
}

/**
 * Says whether a live server can be offered: no plugin contributes one, one does but is not installed,
 * or one is installed and ready to start.
 */
export type LiveServerAvailability = 'none' | 'not-installed' | 'ready';

/**
 * Describes a running live server.
 */
export interface LiveServerInfo {
  /**
   * Gets the workspace root it serves, as the renderer opened it.
   */
  readonly root: string;

  /**
   * Gets the address it serves at, such as `http://127.0.0.1:5500/`.
   */
  readonly url: string;

  /**
   * Gets the port it listens on.
   */
  readonly port: number;

  /**
   * Gets the display name of the plugin serving it.
   */
  readonly displayName: string;
}

/**
 * Describes the answer to {@link LiveServerChannel.Open}: the server and the page's own address, or why
 * there is none.
 */
export type LiveServerOpenAnswer =
  | {
      /**
       * Discriminates the success case.
       */
      readonly ok: true;

      /**
       * Gets the server serving the page.
       */
      readonly server: LiveServerInfo;

      /**
       * Gets the page's address on it.
       */
      readonly pageUrl: string;
    }
  | {
      /**
       * Discriminates the failure case.
       */
      readonly ok: false;

      /**
       * Gets the reason, in the user's terms.
       */
      readonly error: string;
    };
