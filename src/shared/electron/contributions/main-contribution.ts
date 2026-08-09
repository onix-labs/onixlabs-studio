import type { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent } from 'electron';

/**
 * Names a privileged capability a contribution declares it needs (for example `docker.socket`). In
 * this phase the field is threaded through but never granted or denied; capability enforcement — the
 * grantor that turns a request into a resource, or refuses it — arrives in P2 (#390). Kept as a bare
 * string here so it can be refined into a richer shape without churning every contribution.
 */
export type CapabilityRequest = string;

/**
 * Handles a renderer `invoke` and returns its reply (invoke → handle). Mirrors the shape
 * {@link Electron.IpcMain.handle} expects.
 */
export type InvokeHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

/**
 * Handles a fire-and-forget renderer `send` (no reply). Mirrors the shape
 * {@link Electron.IpcMain.on} expects.
 */
export type ContributionListener = (event: IpcMainEvent, ...args: unknown[]) => void;

/**
 * The narrow logging surface handed to a contribution, namespaced by its id. Deliberately smaller
 * than the main-process {@link import('../logger').Logger}: a contribution only ever emits at these
 * three severities, and the id prefix is applied for it so its lines are attributable.
 */
export interface ContributionLogger {
  /**
   * Logs an error the contribution encountered.
   * @param message The message text.
   * @param details Optional structured detail appended to the line.
   */
  error(message: string, ...details: unknown[]): void;

  /**
   * Logs a warning from the contribution.
   * @param message The message text.
   * @param details Optional structured detail appended to the line.
   */
  warn(message: string, ...details: unknown[]): void;

  /**
   * Logs an informational line from the contribution.
   * @param message The message text.
   * @param details Optional structured detail appended to the line.
   */
  info(message: string, ...details: unknown[]): void;
}

/**
 * The surface a {@link MainContribution} is handed at activation — everything it reaches the
 * application through. IPC registered via {@link handle}/{@link on} is tracked and removed
 * automatically when the contribution is disposed, so a contribution never leaks handlers.
 */
export interface ContributionContext {
  /**
   * Registers an invoke-style handler (renderer `invoke` → reply). Removed automatically on dispose.
   * @param channel The IPC channel; conventionally namespaced by the contribution id.
   * @param handler The handler invoked for each request.
   */
  handle(channel: string, handler: InvokeHandler): void;

  /**
   * Registers a fire-and-forget listener (renderer `send`). Removed automatically on dispose.
   * @param channel The IPC channel; conventionally namespaced by the contribution id.
   * @param listener The listener invoked for each message.
   */
  on(channel: string, listener: ContributionListener): void;

  /**
   * Pushes a message to the main window's renderer. A no-op when the window is gone — the event-stream
   * path a backend contribution uses to notify the renderer.
   * @param channel The IPC channel to push on.
   * @param payload The payload sent to the renderer.
   */
  send(channel: string, ...payload: unknown[]): void;

  /**
   * Resolves a declared capability to its granted resource, or throws when it is not granted. In this
   * phase there is no grantor, so this always throws; P2 (#390) supplies the real resolution.
   * @param request The capability the contribution declared.
   * @returns Returns the granted resource for the capability.
   */
  capability<T = unknown>(request: CapabilityRequest): T;

  /**
   * Gets the main window, for the rare contribution that needs it directly, or null when there is none.
   * @returns Returns the main window, or null.
   */
  mainWindow(): BrowserWindow | null;

  /**
   * Gets the contribution's logger, namespaced by its id.
   */
  readonly log: ContributionLogger;
}

/**
 * A main-process feature contribution — the backend analog of a renderer feature descriptor. A
 * contribution brings its own IPC handlers, its renderer push channel, and its declared capabilities,
 * and is activated and disposed by the {@link import('./main-contribution-registry').MainContributionRegistry}
 * without any edit to the application's construction or teardown logic.
 */
export interface MainContribution {
  /**
   * Gets the stable identifier for the contribution. Also the recommended IPC channel namespace (for
   * example `docker`, owning `docker:list`, `docker:events`).
   */
  readonly id: string;

  /**
   * Gets the privileged capabilities this contribution needs. Threaded through in this phase; gated
   * in P2 (#390).
   */
  readonly capabilities?: readonly CapabilityRequest[];

  /**
   * Wires IPC and starts work. May be asynchronous. A throw is isolated by the registry: the
   * contribution's partial registrations are rolled back and startup continues.
   * @param context The surface the contribution reaches the application through.
   */
  activate(context: ContributionContext): void | Promise<void>;

  /**
   * Performs extra teardown beyond the IPC registered through the context (which is removed
   * automatically). Optional.
   */
  dispose?(): void | Promise<void>;
}
