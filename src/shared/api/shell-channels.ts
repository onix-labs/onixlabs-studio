/**
 * Names the operating-system shell IPC channels. This is the shell capability's slice of the IPC
 * contract: the shared shell client and the main-process handler name their channels from here, over
 * the generic {@link import('./bridge').Bridge} transport. The main process validates every target
 * before opening it, so a hostile renderer cannot open arbitrary schemes.
 */
export enum ShellChannel {
  /**
   * Opens a file-system path in the operating system's default handler (invoke).
   */
  OpenPath = 'shell:open-path',

  /**
   * Opens an external URL in the operating system's default browser; only http/https/mailto are
   * honoured, anything else is ignored (invoke).
   */
  OpenExternal = 'shell:open-external',

  /**
   * Reveals a file-system path in the operating system's file manager, selecting the item within its
   * containing folder (invoke).
   */
  RevealPath = 'shell:reveal-path',
}
