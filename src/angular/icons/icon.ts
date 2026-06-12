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

  // --- Ribbon: file commands ---

  /**
   * Gets the open-file/folder icon.
   */
  public static readonly FOLDER_OPEN: Icon = new Icon('ph ph-folder-open');

  /**
   * Gets the save icon.
   */
  public static readonly SAVE: Icon = new Icon('ph ph-floppy-disk');

  /**
   * Gets the save-as icon.
   */
  public static readonly SAVE_AS: Icon = new Icon('ph ph-floppy-disk-back');

  // --- Ribbon: edit commands ---

  /**
   * Gets the cut icon.
   */
  public static readonly CUT: Icon = new Icon('ph ph-scissors');

  /**
   * Gets the copy icon.
   */
  public static readonly COPY: Icon = new Icon('ph ph-copy');

  /**
   * Gets the paste icon.
   */
  public static readonly PASTE: Icon = new Icon('ph ph-clipboard');

  /**
   * Gets the undo icon.
   */
  public static readonly UNDO: Icon = new Icon('ph ph-arrow-u-up-left');

  /**
   * Gets the redo icon.
   */
  public static readonly REDO: Icon = new Icon('ph ph-arrow-u-up-right');

  /**
   * Gets the find/search icon.
   */
  public static readonly SEARCH: Icon = new Icon('ph ph-magnifying-glass');

  // --- Ribbon: run and format ---

  /**
   * Gets the run/play/start icon.
   */
  public static readonly PLAY: Icon = new Icon('ph ph-play');

  /**
   * Gets the stop icon.
   */
  public static readonly STOP: Icon = new Icon('ph ph-stop');

  /**
   * Gets the format-document (magic wand) icon.
   */
  public static readonly FORMAT: Icon = new Icon('ph ph-magic-wand');

  /**
   * Gets the refresh/restart icon.
   */
  public static readonly REFRESH: Icon = new Icon('ph ph-arrows-clockwise');

  /**
   * Gets the erase/clear icon.
   */
  public static readonly ERASER: Icon = new Icon('ph ph-eraser');

  // --- Ribbon: markdown text formatting ---

  /**
   * Gets the bold icon.
   */
  public static readonly BOLD: Icon = new Icon('ph ph-text-b');

  /**
   * Gets the italic icon.
   */
  public static readonly ITALIC: Icon = new Icon('ph ph-text-italic');

  /**
   * Gets the strikethrough icon.
   */
  public static readonly STRIKETHROUGH: Icon = new Icon('ph ph-text-strikethrough');

  /**
   * Gets the inline-code icon.
   */
  public static readonly CODE_INLINE: Icon = new Icon('ph ph-code');

  /**
   * Gets the bullet-list icon.
   */
  public static readonly BULLET_LIST: Icon = new Icon('ph ph-list-bullets');

  /**
   * Gets the numbered-list icon.
   */
  public static readonly NUMBERED_LIST: Icon = new Icon('ph ph-list-numbers');

  /**
   * Gets the table icon.
   */
  public static readonly TABLE: Icon = new Icon('ph ph-table');

  /**
   * Gets the horizontal-divider icon.
   */
  public static readonly DIVIDER: Icon = new Icon('ph ph-minus');

  // --- Ribbon: build and source control ---

  /**
   * Gets the build icon.
   */
  public static readonly BUILD: Icon = new Icon('ph ph-squares-four');

  /**
   * Gets the rebuild icon.
   */
  public static readonly REBUILD: Icon = new Icon('ph ph-stack');

  /**
   * Gets the clean icon.
   */
  public static readonly CLEAN: Icon = new Icon('ph ph-broom');

  /**
   * Gets the git-commit icon.
   */
  public static readonly GIT_COMMIT: Icon = new Icon('ph ph-git-commit');

  /**
   * Gets the upward-arrow (push) icon.
   */
  public static readonly ARROW_UP: Icon = new Icon('ph ph-arrow-up');

  /**
   * Gets the downward-arrow (pull) icon.
   */
  public static readonly ARROW_DOWN: Icon = new Icon('ph ph-arrow-down');

  // --- Ribbon: agent commands ---

  /**
   * Gets the new-chat icon.
   */
  public static readonly NEW_CHAT: Icon = new Icon('ph ph-chat-circle-dots');

  /**
   * Gets the attach-file (paperclip) icon.
   */
  public static readonly PAPERCLIP: Icon = new Icon('ph ph-paperclip');

  /**
   * Gets the add-folder icon.
   */
  public static readonly FOLDER_PLUS: Icon = new Icon('ph ph-folder-plus');

  // --- Ribbon: terminal navigation ---

  /**
   * Gets the list icon.
   */
  public static readonly LIST: Icon = new Icon('ph ph-list');

  /**
   * Gets the detailed-list icon.
   */
  public static readonly LIST_ALL: Icon = new Icon('ph ph-list-dashes');

  /**
   * Gets the home-directory icon.
   */
  public static readonly HOME: Icon = new Icon('ph ph-house');

  /**
   * Gets the root-directory icon.
   */
  public static readonly ROOT: Icon = new Icon('ph ph-folder-simple');

  // --- Dock: panels ---

  /**
   * Gets the Solution Explorer panel icon.
   */
  public static readonly SOLUTION_EXPLORER: Icon = new Icon('ph ph-tree-structure');

  /**
   * Gets the Output panel icon.
   */
  public static readonly OUTPUT: Icon = new Icon('ph ph-terminal');

  /**
   * Gets the Error List (problems) panel icon.
   */
  public static readonly PROBLEMS: Icon = new Icon('ph ph-warning');

  // --- Dock: chrome affordances ---

  /**
   * Gets the auto-hide (collapse to strip) icon.
   */
  public static readonly AUTO_HIDE: Icon = new Icon('ph ph-sidebar-simple');

  /**
   * Gets the float (picture-in-picture) icon.
   */
  public static readonly FLOAT: Icon = new Icon('ph ph-picture-in-picture');

  /**
   * Gets the re-dock icon shown on floating and auto-hidden panels.
   */
  public static readonly DOCK: Icon = new Icon('ph ph-arrow-line-down');

  /**
   * Gets the pin (re-dock from auto-hide) icon.
   */
  public static readonly PIN: Icon = new Icon('ph ph-push-pin');

  /**
   * Gets the drag-handle (grip) icon.
   */
  public static readonly GRIP: Icon = new Icon('ph ph-dots-six');

  // --- Solution Explorer: tree ---

  /**
   * Gets the collapsed-folder icon.
   */
  public static readonly FOLDER: Icon = new Icon('ph ph-folder');

  /**
   * Gets the generic file icon.
   */
  public static readonly FILE: Icon = new Icon('ph ph-file');

  /**
   * Gets the hidden (dotfile) icon.
   */
  public static readonly FILE_HIDDEN: Icon = new Icon('ph ph-file-dashed');

  /**
   * Gets the TypeScript file icon.
   */
  public static readonly FILE_TYPESCRIPT: Icon = new Icon('ph ph-file-ts');

  /**
   * Gets the JavaScript file icon.
   */
  public static readonly FILE_JAVASCRIPT: Icon = new Icon('ph ph-file-js');

  /**
   * Gets the JSON file icon.
   */
  public static readonly FILE_JSON: Icon = new Icon('ph ph-brackets-curly');

  /**
   * Gets the Markdown file icon.
   */
  public static readonly FILE_MARKDOWN: Icon = new Icon('ph ph-file-md');

  /**
   * Gets the stylesheet (CSS/SCSS) file icon.
   */
  public static readonly FILE_STYLESHEET: Icon = new Icon('ph ph-file-css');

  /**
   * Gets the HTML file icon.
   */
  public static readonly FILE_HTML: Icon = new Icon('ph ph-file-html');

  /**
   * Gets the spinner icon shown while a directory loads.
   */
  public static readonly SPINNER: Icon = new Icon('ph ph-circle-notch');

  // --- Problems: severities ---

  /**
   * Gets the error-severity icon.
   */
  public static readonly ERROR: Icon = new Icon('ph ph-x-circle');

  /**
   * Gets the warning-severity icon.
   */
  public static readonly WARNING: Icon = new Icon('ph ph-warning');

  /**
   * Gets the information-severity icon.
   */
  public static readonly INFO: Icon = new Icon('ph ph-info');

  /**
   * Gets the hint-severity icon.
   */
  public static readonly HINT: Icon = new Icon('ph ph-lightbulb');

  /**
   * Gets the success icon shown when there are no problems.
   */
  public static readonly SUCCESS: Icon = new Icon('ph ph-check-circle');

  // --- Agent chat ---

  /**
   * Gets the user avatar icon.
   */
  public static readonly USER: Icon = new Icon('ph ph-user');

  /**
   * Gets the send-message icon.
   */
  public static readonly SEND: Icon = new Icon('ph ph-paper-plane-tilt');

  // --- Shared affordances ---

  /**
   * Gets the downward caret used on menus and split buttons.
   */
  public static readonly CARET_DOWN: Icon = new Icon('ph ph-caret-down');

  /**
   * Gets the rightward caret used on collapsed tree nodes.
   */
  public static readonly CARET_RIGHT: Icon = new Icon('ph ph-caret-right');

  /**
   * Initialises a new instance of the {@link Icon} class.
   * @param classList The CSS class list that renders the icon.
   */
  private constructor(public readonly classList: string) {}
}
