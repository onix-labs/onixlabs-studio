/**
 * Represents an icon in the application's icon set.
 *
 * This is a strongly-typed enumeration: every icon the application renders is exposed as a static
 * member, each mapping a semantic icon to the CSS class list that draws it. Call sites reference the
 * member (such as {@link Icon.SETTINGS}) through the `app-icon` component and never the underlying
 * class string, so replacing the icon library — or changing an icon's weight or variant — is a
 * change to this file alone.
 *
 * The weight/variant is deliberately baked into each class list rather than chosen at the call site,
 * because a replacement library is not guaranteed to offer the same variants; keeping the variant
 * here means a future swap never has to revisit every `app-icon` instance.
 *
 * Icons are currently drawn from Phosphor Icons (`ph ph-{name}` for the regular weight). Other
 * weights — `ph-thin`, `ph-light`, `ph-bold`, `ph-fill`, `ph-duotone` — require their stylesheet to
 * be registered in `angular.json`; see `src/angular/styles/_icons.scss`.
 */
export class Icon {
  // --- Title strip: action buttons ---

  /**
   * Gets the settings icon, shown on the settings button and the settings tab.
   */
  public static readonly SETTINGS: Icon = new Icon('ph ph-gear-six');

  /**
   * Gets the new-tab (grid-dots) icon shown on the new-tab button.
   */
  public static readonly GRID_DOTS: Icon = new Icon('ph ph-dots-nine');

  /**
   * Gets the close icon shown on tab close buttons.
   */
  public static readonly CLOSE: Icon = new Icon('ph ph-x');

  // --- Title strip: window lock ---

  /**
   * Gets the closed-padlock icon shown when the window is locked in place.
   */
  public static readonly LOCK: Icon = new Icon('ph ph-lock');

  /**
   * Gets the open-padlock icon shown when the window is free to move.
   */
  public static readonly LOCK_OPEN: Icon = new Icon('ph ph-lock-open');

  // --- Title strip: window controls ---

  /**
   * Gets the window-minimize icon.
   */
  public static readonly WINDOW_MINIMIZE: Icon = new Icon('ph ph-minus');

  /**
   * Gets the window-maximize icon.
   */
  public static readonly WINDOW_MAXIMIZE: Icon = new Icon('ph ph-square');

  /**
   * Gets the window-close icon.
   */
  public static readonly WINDOW_CLOSE: Icon = new Icon('ph ph-x');

  // --- Tab types ---

  /**
   * Gets the directory (workspace) tab icon.
   */
  public static readonly DIRECTORY: Icon = new Icon('ph ph-folder');

  /**
   * Gets the code tab icon.
   */
  public static readonly CODE: Icon = new Icon('ph ph-file-code');

  /**
   * Gets the markdown tab icon.
   */
  public static readonly MARKDOWN: Icon = new Icon('ph ph-markdown-logo');

  /**
   * Gets the terminal tab icon.
   */
  public static readonly TERMINAL: Icon = new Icon('ph ph-terminal-window');

  /**
   * Gets the agent tab icon.
   */
  public static readonly AGENT: Icon = new Icon('ph ph-robot');

  /**
   * Initialises a new instance of the {@link Icon} class.
   * @param classList The CSS class list that renders the icon.
   */
  private constructor(public readonly classList: string) {}
}
