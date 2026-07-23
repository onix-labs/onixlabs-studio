/**
 * Identifies what role a window plays. The main window hosts the full IDE and is the default target
 * for renderer-push events; pop-out windows host individual surfaces (a dock panel) and never gate
 * application lifecycle.
 */
export type WindowKind = 'main' | 'popout';

/**
 * Describes a window tracked by the registry.
 */
export interface RegisteredWindow<TWindow> {
  /**
   * Gets the registry-minted identifier of the window.
   */
  readonly id: number;

  /**
   * Gets the role the window plays.
   */
  readonly kind: WindowKind;

  /**
   * Gets the window itself.
   */
  readonly window: TWindow;
}

/**
 * Tracks the application's windows by kind. Generic over the window type so the bookkeeping stays
 * pure and unit-testable without the electron module; the {@link WindowManager} instantiates it with
 * `BrowserWindow`.
 */
export class WindowRegistry<TWindow> {
  /**
   * Holds the registered windows by identifier, in registration order.
   */
  private readonly entries: Map<number, RegisteredWindow<TWindow>> = new Map<
    number,
    RegisteredWindow<TWindow>
  >();

  /**
   * Holds the next identifier to mint.
   */
  private nextId: number = 1;

  /**
   * Registers a window.
   * @param kind The role the window plays.
   * @param window The window to register.
   * @returns Returns the registered entry, whose identifier deregisters it later.
   */
  public add(kind: WindowKind, window: TWindow): RegisteredWindow<TWindow> {
    const entry: RegisteredWindow<TWindow> = { id: this.nextId++, kind, window };
    this.entries.set(entry.id, entry);
    return entry;
  }

  /**
   * Deregisters a window. Unknown identifiers are ignored.
   * @param id The identifier of the window to deregister.
   */
  public remove(id: number): void {
    this.entries.delete(id);
  }

  /**
   * Gets a registered window by identifier.
   * @param id The identifier to resolve.
   * @returns Returns the window, or null when the identifier is unknown.
   */
  public byId(id: number): TWindow | null {
    return this.entries.get(id)?.window ?? null;
  }

  /**
   * Gets a registered entry — the window together with its kind — by identifier.
   * @param id The identifier to resolve.
   * @returns Returns the entry, or null when the identifier is unknown.
   */
  public entry(id: number): RegisteredWindow<TWindow> | null {
    return this.entries.get(id) ?? null;
  }

  /**
   * Gets the main application window: the earliest-registered entry of the main kind.
   * @returns Returns the main window, or null when none is registered.
   */
  public main(): TWindow | null {
    for (const entry of this.entries.values()) {
      if (entry.kind === 'main') {
        return entry.window;
      }
    }
    return null;
  }

  /**
   * Gets every registered window, in registration order.
   * @returns Returns the registered entries.
   */
  public all(): readonly RegisteredWindow<TWindow>[] {
    return Array.from(this.entries.values());
  }
}
