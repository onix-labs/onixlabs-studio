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
 * here means a future swap never has to revisit every `app-icon` instance. Size, colour and rotation
 * remain presentational and are chosen per instance.
 *
 * Icons are drawn from Phosphor Icons. The regular (`ph ph-{name}`), bold (`ph-bold ph-{name}`),
 * fill (`ph-fill ph-{name}`) and duotone (`ph-duotone ph-{name}`) weights are loaded; see
 * `src/angular/styles/_icons.scss`.
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
  public static readonly GRID_DOTS: Icon = new Icon('ph-bold ph-dots-nine');

  /**
   * Gets the mission-control (rocket-launch) icon shown on the title-strip button that opens the
   * Mission Control tab and on the tab itself.
   */
  public static readonly ROCKET_LAUNCH: Icon = new Icon('ph-duotone ph-rocket-launch');

  /**
   * Gets the hide-empty-agents icon shown on Mission Control's View group toggle.
   */
  public static readonly HIDE_EMPTY: Icon = new Icon('ph-duotone ph-circle-dashed');

  /**
   * Gets the hide-idle-agents icon shown on Mission Control's View group toggle.
   */
  public static readonly HIDE_IDLE: Icon = new Icon('ph-duotone ph-pause-circle');

  /**
   * Gets the icon marking a shown agent on Mission Control's per-agent hide toggle.
   */
  public static readonly AGENT_VISIBLE: Icon = new Icon('ph ph-eye');

  /**
   * Gets the icon marking a hidden agent on Mission Control's per-agent hide toggle.
   */
  public static readonly AGENT_HIDDEN: Icon = new Icon('ph ph-eye-slash');

  /**
   * Gets the close icon shown on tab close buttons.
   */
  public static readonly CLOSE: Icon = new Icon('ph ph-x');

  /**
   * Gets the expand icon shown on a modal's expand-to-fill control. Same weight as {@link CLOSE}.
   */
  public static readonly ARROWS_OUT: Icon = new Icon('ph ph-arrows-out-simple');

  /**
   * Gets the restore icon shown on a modal's expand control once expanded. Same weight as {@link CLOSE}.
   */
  public static readonly ARROWS_IN: Icon = new Icon('ph ph-arrows-in-simple');

  /**
   * Gets the frame-corners icon shown on a panel's focus control, presenting the panel in a large modal.
   */
  public static readonly FRAME_CORNERS: Icon = new Icon('ph-duotone ph-frame-corners');

  // --- Title strip: window lock ---

  /**
   * Gets the closed-padlock icon shown when the window is locked in place.
   */
  public static readonly LOCK: Icon = new Icon('ph-fill ph-lock-simple');

  /**
   * Gets the open-padlock icon shown when the window is free to move.
   */
  public static readonly LOCK_OPEN: Icon = new Icon('ph-bold ph-lock-simple-open');

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

  // --- Content types (tabs, welcome, document wells) ---

  /**
   * Gets the directory (workspace) content icon.
   */
  public static readonly DIRECTORY: Icon = new Icon('ph-duotone ph-folder-simple');

  /**
   * Gets the loading-folder (dashed) icon shown on a Solution Explorer folder while any project
   * beneath it is still loading; it resolves to {@link Icon.DIRECTORY} once loaded.
   */
  public static readonly FOLDER_LOADING: Icon = new Icon('ph-duotone ph-folder-simple-dashed');

  /**
   * Gets the code content icon.
   */
  public static readonly CODE: Icon = new Icon('ph-duotone ph-brackets-curly');

  /**
   * Gets the markdown content icon.
   */
  public static readonly MARKDOWN: Icon = new Icon('ph-duotone ph-markdown-logo');

  /**
   * Gets the filled markdown-logo icon shown on the agent composer's Edit (write-in-markdown) button.
   */
  public static readonly MARKDOWN_FILL: Icon = new Icon('ph-fill ph-markdown-logo');

  /**
   * Gets the binary/hex content icon.
   */
  public static readonly BINARY: Icon = new Icon('ph-duotone ph-binary');

  /**
   * Gets the terminal content icon.
   */
  public static readonly TERMINAL: Icon = new Icon('ph-duotone ph-terminal-window');

  /**
   * Gets the Containers (Docker) content icon.
   */
  public static readonly CONTAINERS: Icon = new Icon('ph-duotone ph-shipping-container');

  /**
   * Gets the agent content icon.
   */
  public static readonly AGENT: Icon = new Icon('ph-duotone ph-brain');

  /**
   * The bell shown when agent requests are waiting for the user.
   */
  public static readonly BELL: Icon = new Icon('ph-duotone ph-bell-ringing');

  /**
   * Gets the thin agent (brain) glyph shown large in the agent panel's empty state.
   */
  public static readonly AGENT_EMPTY: Icon = new Icon('ph-thin ph-brain');

  /**
   * Gets the glyph marking the agent's reasoning (a settled thinking disclosure in the transcript).
   */
  public static readonly THINKING: Icon = new Icon('ph ph-brain');

  /**
   * Gets the glyph for an attached editor selection (agent context).
   */
  public static readonly SELECTION: Icon = new Icon('ph ph-selection');

  /**
   * Gets the glyph marking a sub-agent lane (a Task spawning nested work) in the agent transcript.
   */
  public static readonly SUBAGENT: Icon = new Icon('ph-duotone ph-robot');

  /**
   * Gets the sparkle glyph marking an AI-assisted action (for example generating a commit message).
   */
  public static readonly SPARKLE: Icon = new Icon('ph ph-sparkle');

  /**
   * Gets the generic action glyph shown on an agent tool-call timeline node.
   */
  public static readonly ACTION: Icon = new Icon('ph ph-lightning');

  // --- Ribbon: file commands ---

  /**
   * Gets the open-file/folder icon.
   */
  public static readonly FOLDER_OPEN: Icon = new Icon('ph-duotone ph-folder-open');

  /**
   * Gets the save icon.
   */
  public static readonly SAVE: Icon = new Icon('ph-duotone ph-floppy-disk');

  /**
   * Gets the save-as (save to a new file) icon.
   */
  public static readonly SAVE_AS: Icon = new Icon('ph-duotone ph-floppy-disk-back');

  /**
   * Gets the save-all (save every unsaved document) icon.
   */
  public static readonly SAVE_ALL: Icon = new Icon('ph-duotone ph-copy-simple');

  /**
   * Gets the code-cleanup icon (organise imports, then format).
   */
  public static readonly CODE_CLEANUP: Icon = new Icon('ph-duotone ph-sparkle');

  /**
   * Gets the layout-preset icon, used by the ribbon's View group for the default layout.
   */
  public static readonly LAYOUT_PRESET: Icon = new Icon('ph-duotone ph-layout');

  /**
   * Gets the manage/settings-list icon, used for management dialogs.
   */
  public static readonly MANAGE: Icon = new Icon('ph-duotone ph-sliders-horizontal');

  /**
   * Gets the default-marker (star) icon.
   */
  public static readonly STAR: Icon = new Icon('ph-fill ph-star');

  /**
   * Gets the export-to-PDF icon.
   */
  public static readonly EXPORT_PDF: Icon = new Icon('ph-duotone ph-file-pdf');

  /**
   * Gets the print icon.
   */
  public static readonly PRINT: Icon = new Icon('ph-duotone ph-printer');

  // --- Ribbon: edit commands ---

  /**
   * Gets the cut icon.
   */
  public static readonly CUT: Icon = new Icon('ph-duotone ph-scissors');

  /**
   * Gets the copy icon.
   */
  public static readonly COPY: Icon = new Icon('ph-duotone ph-copy-simple');

  /**
   * Gets the paste icon.
   */
  public static readonly PASTE: Icon = new Icon('ph-duotone ph-clipboard');

  /**
   * Gets the undo icon.
   */
  public static readonly UNDO: Icon = new Icon('ph ph-arrow-u-up-left');

  /**
   * Gets the redo icon.
   */
  public static readonly REDO: Icon = new Icon('ph ph-arrow-u-down-right');

  /**
   * Gets the find/search icon.
   */
  public static readonly SEARCH: Icon = new Icon('ph-duotone ph-magnifying-glass');

  // --- Ribbon: run, format and session ---

  /**
   * Gets the run/play/start icon.
   */
  public static readonly PLAY: Icon = new Icon('ph-duotone ph-play');

  /**
   * Gets the stop icon.
   */
  public static readonly STOP: Icon = new Icon('ph-duotone ph-stop');

  /**
   * Gets the pause icon, shown on the Reader panel's transport toggle while playing.
   */
  public static readonly PAUSE: Icon = new Icon('ph-fill ph-pause');

  /**
   * Gets the filled play icon, shown on the Reader panel's transport toggle while paused.
   */
  public static readonly PLAY_FILL: Icon = new Icon('ph-fill ph-play');

  /**
   * Gets the skip-to-previous icon, shown on the Reader panel's previous-paragraph control.
   */
  public static readonly SKIP_BACK: Icon = new Icon('ph-fill ph-skip-back');

  /**
   * Gets the skip-to-next icon, shown on the Reader panel's next-paragraph control.
   */
  public static readonly SKIP_FORWARD: Icon = new Icon('ph-fill ph-skip-forward');

  /**
   * Gets the debug icon.
   */
  public static readonly DEBUG: Icon = new Icon('ph-duotone ph-bug');

  /**
   * Gets the format-document (magic wand) icon.
   */
  public static readonly FORMAT: Icon = new Icon('ph-duotone ph-magic-wand');

  /**
   * Gets the clear icon (terminal screen, agent conversation).
   */
  public static readonly CLEAR: Icon = new Icon('ph-duotone ph-trash-simple');

  /**
   * Gets the compact-conversation icon.
   */
  public static readonly COMPACT: Icon = new Icon('ph-duotone ph-trash');

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
   * Gets the align-left icon.
   */
  public static readonly ALIGN_LEFT: Icon = new Icon('ph ph-text-align-left');

  /**
   * Gets the align-center icon.
   */
  public static readonly ALIGN_CENTER: Icon = new Icon('ph ph-text-align-center');

  /**
   * Gets the align-right icon.
   */
  public static readonly ALIGN_RIGHT: Icon = new Icon('ph ph-text-align-right');

  /**
   * Gets the table icon.
   */
  public static readonly TABLE: Icon = new Icon('ph-duotone ph-grid-nine');

  /**
   * Gets the horizontal-divider icon.
   */
  public static readonly DIVIDER: Icon = new Icon('ph ph-minus');

  /**
   * Gets the image icon, shown on the markdown Insert group's Image button.
   */
  public static readonly IMAGE: Icon = new Icon('ph ph-image');

  /**
   * Gets the link icon, shown on the markdown Insert group's Link button.
   */
  public static readonly LINK: Icon = new Icon('ph ph-link');

  /**
   * Gets the math icon, shown on the markdown Insert group's Math button.
   */
  public static readonly MATH: Icon = new Icon('ph ph-function');

  /**
   * Gets the diagram icon, shown on the markdown Insert group's Diagram button.
   */
  public static readonly DIAGRAM: Icon = new Icon('ph ph-graph');

  /**
   * Gets the footnote icon, shown on the markdown Insert group's Footnote button.
   */
  public static readonly FOOTNOTE: Icon = new Icon('ph ph-asterisk');

  /**
   * Gets the collapse (details/summary) icon, shown on the markdown Insert group's Collapse button.
   */
  public static readonly COLLAPSE: Icon = new Icon('ph ph-caret-circle-down');

  /**
   * Gets the emoji icon, shown on the markdown Insert group's Emoji button.
   */
  public static readonly EMOJI: Icon = new Icon('ph ph-smiley');

  /**
   * Gets the outline icon, shown on the markdown Tools group's Outline button.
   */
  public static readonly OUTLINE: Icon = new Icon('ph ph-list-dashes');

  /**
   * Gets the review (spelling and grammar) icon, shown on the markdown Tools group's Review button.
   */
  public static readonly REVIEW: Icon = new Icon('ph-duotone ph-text-aa');

  /**
   * Gets the reader (read-aloud) icon, shown on the markdown Tools group's Reader button.
   */
  public static readonly READER: Icon = new Icon('ph-duotone ph-speaker-high');

  /**
   * Gets the refresh icon, shown on the Review panel's re-analyse action.
   */
  public static readonly REFRESH: Icon = new Icon('ph ph-arrow-clockwise');

  /**
   * Gets the check icon, shown on the Review panel's primary suggestion.
   */
  public static readonly CHECK: Icon = new Icon('ph ph-check');

  /**
   * Gets the dictionary (book) icon, shown on the Review panel's add-to-dictionary action.
   */
  public static readonly DICTIONARY: Icon = new Icon('ph ph-book-bookmark');

  /**
   * Gets the bullet-list icon.
   */
  public static readonly BULLET_LIST: Icon = new Icon('ph ph-list-bullets');

  /**
   * Gets the numbered-list icon.
   */
  public static readonly NUMBERED_LIST: Icon = new Icon('ph ph-list-numbers');

  /**
   * Gets the task-list icon.
   */
  public static readonly TASK_LIST: Icon = new Icon('ph ph-list-checks');

  // --- Ribbon: build and source control ---

  /**
   * Gets the build icon.
   */
  public static readonly BUILD: Icon = new Icon('ph-duotone ph-stack');

  /**
   * Gets the rebuild icon.
   */
  public static readonly REBUILD: Icon = new Icon('ph-duotone ph-stack-plus');

  /**
   * Gets the clean icon.
   */
  public static readonly CLEAN: Icon = new Icon('ph-duotone ph-broom');

  /**
   * Gets the git-commit icon.
   */
  public static readonly GIT_COMMIT: Icon = new Icon('ph-duotone ph-git-commit');

  /**
   * Gets the source-control (git-branch) icon shown on the source-control tab.
   */
  public static readonly SOURCE_CONTROL: Icon = new Icon('ph-duotone ph-git-branch');

  /**
   * Gets the git-merge icon shown on merge commits and the ribbon's Merge action.
   */
  public static readonly GIT_MERGE: Icon = new Icon('ph-duotone ph-git-merge');

  /**
   * Gets the git-diff icon shown on the diff surface and the ribbon's compare action.
   */
  public static readonly GIT_DIFF: Icon = new Icon('ph-duotone ph-git-diff');

  /**
   * Gets the pull-request icon shown on the ribbon's Pull Request action.
   */
  public static readonly GIT_PULL_REQUEST: Icon = new Icon('ph-duotone ph-git-pull-request');

  /**
   * Gets the tag icon shown on the source-control tags section and tag refs.
   */
  public static readonly TAG: Icon = new Icon('ph-duotone ph-tag');

  /**
   * Gets the stash icon shown on the source-control stashes section and the ribbon's Stash action.
   */
  public static readonly STASH: Icon = new Icon('ph-duotone ph-archive');

  /**
   * Gets the worktree icon shown on the Worktrees panel, the ribbon's Promote action, and the
   * status strip's active-checkout indicator.
   */
  public static readonly WORKTREE: Icon = new Icon('ph-duotone ph-tree-structure');

  /**
   * Gets the remote (cloud) icon shown on the source-control remotes section.
   */
  public static readonly CLOUD: Icon = new Icon('ph-duotone ph-cloud');

  /**
   * Gets the working-changes (pencil) icon shown on the source-control uncommitted-changes node.
   */
  public static readonly PENCIL: Icon = new Icon('ph-duotone ph-pencil-simple');

  /**
   * Gets the upward-arrow (push) icon.
   */
  public static readonly ARROW_UP: Icon = new Icon('ph ph-arrow-up');

  /**
   * Gets the downward-arrow (pull) icon.
   */
  public static readonly ARROW_DOWN: Icon = new Icon('ph ph-arrow-down');

  /**
   * Gets the commits-to-push (bold up arrow) icon shown on the workspace status bar's ahead count.
   */
  public static readonly COMMITS_AHEAD: Icon = new Icon('ph-bold ph-arrow-up');

  /**
   * Gets the commits-to-pull (bold down arrow) icon shown on the workspace status bar's behind count.
   */
  public static readonly COMMITS_BEHIND: Icon = new Icon('ph-bold ph-arrow-down');

  /**
   * Gets the branch (bold git-branch) icon shown on the workspace status bar's branch segment.
   */
  public static readonly BRANCH: Icon = new Icon('ph-bold ph-git-branch');

  /**
   * Gets the workspace-folder icon shown on the workspace status bar's name segment.
   */
  public static readonly FOLDER_SIMPLE: Icon = new Icon('ph-fill ph-folder-simple');

  /**
   * Gets the language-servers (article) icon shown on the workspace status bar's language-server menu.
   */
  public static readonly ARTICLE: Icon = new Icon('ph-duotone ph-article');

  // --- Ribbon: agent and terminal ---

  /**
   * Gets the attach-file icon.
   */
  public static readonly ATTACH: Icon = new Icon('ph-duotone ph-file-plus');

  /**
   * Gets the add-folder icon.
   */
  public static readonly FOLDER_PLUS: Icon = new Icon('ph-duotone ph-folder-simple-plus');

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
  public static readonly HOME: Icon = new Icon('ph-duotone ph-house-line');

  /**
   * Gets the root-directory icon.
   */
  public static readonly ROOT: Icon = new Icon('ph-duotone ph-hard-drive');

  // --- Dock: panels ---

  /**
   * Gets the File Explorer panel icon (the filesystem tree).
   */
  public static readonly FILE_EXPLORER: Icon = new Icon('ph ph-folder-open');

  /**
   * Gets the Solution Explorer panel icon (the logical project model).
   */
  public static readonly SOLUTION_EXPLORER: Icon = new Icon('ph ph-tree-structure');

  /**
   * Gets the Output panel icon.
   */
  public static readonly OUTPUT: Icon = new Icon('ph ph-terminal-window');

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
   * Gets the collapse icon for a panel docked on a left or right edge (rotated 180° for the left).
   */
  public static readonly COLLAPSE_HORIZONTAL: Icon = new Icon('ph-duotone ph-square-half');

  /**
   * Gets the collapse icon for a panel docked on a top or bottom edge (rotated 180° for the top).
   */
  public static readonly COLLAPSE_VERTICAL: Icon = new Icon('ph-duotone ph-square-half-bottom');

  /**
   * Gets the full-square icon shown in the compass centre (tab-into) target.
   */
  public static readonly SQUARE: Icon = new Icon('ph-duotone ph-square');

  /**
   * Gets the float icon shown on a docked panel to detach it into a floating window.
   */
  public static readonly FLOAT: Icon = new Icon('ph-duotone ph-push-pin-slash');

  /**
   * Gets the re-dock icon shown on a floating panel to dock it back into the layout.
   */
  public static readonly DOCK: Icon = new Icon('ph-duotone ph-push-pin');

  /**
   * Gets the pin (re-dock from auto-hide) icon.
   */
  public static readonly PIN: Icon = new Icon('ph ph-push-pin');

  /**
   * Gets the pop-out icon, shown in a dock group's title bar for panels that can move into their
   * own OS window.
   */
  public static readonly POP_OUT: Icon = new Icon('ph-duotone ph-cards');

  /**
   * Gets the filled pin icon, used to show an item is pinned.
   */
  public static readonly PIN_FILLED: Icon = new Icon('ph-fill ph-push-pin');

  /**
   * Gets the drag-handle (grip) icon.
   */
  public static readonly GRIP: Icon = new Icon('ph ph-dots-six');

  /**
   * Gets the bold drag-handle (grip) icon, used on the document well's move handle.
   */
  public static readonly GRIP_BOLD: Icon = new Icon('ph-bold ph-dots-six');

  /**
   * Gets the vertical drag-handle (grip) icon, used as a reorder handle on the trailing edge of a list
   * row.
   */
  public static readonly GRIP_VERTICAL: Icon = new Icon('ph ph-dots-six-vertical');

  /**
   * Gets the bold vertical drag-handle (grip) icon, for a reorder handle that should read heavier than
   * the default.
   */
  public static readonly GRIP_VERTICAL_BOLD: Icon = new Icon('ph-bold ph-dots-six-vertical');

  // --- File Explorer: tree files ---

  /**
   * Gets the collapsed-folder icon used outside the tree (such as the terminal cwd segment).
   */
  public static readonly FOLDER: Icon = new Icon('ph ph-folder');

  /**
   * Gets the generic file icon.
   */
  public static readonly FILE: Icon = new Icon('ph ph-file');

  /**
   * Gets the icon for a project node in the Solution Explorer.
   */
  public static readonly PROJECT: Icon = new Icon('ph-duotone ph-cube');

  /**
   * Gets the icon for the Package Management panel.
   */
  public static readonly PACKAGES: Icon = new Icon('ph-duotone ph-package');

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

  /**
   * Gets the restart icon shown on the language-server menu's restart action.
   */
  public static readonly RESTART: Icon = new Icon('ph ph-arrow-clockwise');

  /**
   * Gets the step-over icon shown on the debug toolbar (execute the current line, not into calls).
   */
  public static readonly STEP_OVER: Icon = new Icon('ph ph-arrow-bend-down-right');

  /**
   * Gets the step-into icon shown on the debug toolbar (descend into the call at the current line).
   */
  public static readonly STEP_INTO: Icon = new Icon('ph ph-arrow-line-down');

  /**
   * Gets the step-out icon shown on the debug toolbar (finish the current function and return).
   */
  public static readonly STEP_OUT: Icon = new Icon('ph ph-arrow-line-up');

  // --- Problems: severities and markdown alerts ---

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

  /**
   * Gets the duotone Note icon used by markdown alerts.
   */
  public static readonly ALERT_NOTE: Icon = new Icon('ph-duotone ph-info');

  /**
   * Gets the duotone Tip icon used by markdown alerts.
   */
  public static readonly ALERT_TIP: Icon = new Icon('ph-duotone ph-lightbulb');

  /**
   * Gets the duotone Important icon used by markdown alerts.
   */
  public static readonly ALERT_IMPORTANT: Icon = new Icon('ph-duotone ph-warning-circle');

  /**
   * Gets the duotone Warning icon used by markdown alerts.
   */
  public static readonly ALERT_WARNING: Icon = new Icon('ph-duotone ph-warning');

  /**
   * Gets the duotone Caution icon used by markdown alerts.
   */
  public static readonly ALERT_CAUTION: Icon = new Icon('ph-duotone ph-warning-octagon');

  // --- Agent chat ---

  /**
   * Gets the new-conversation icon (a chat bubble with dots), shown on the agent ribbon's New button.
   */
  public static readonly CHAT_NEW: Icon = new Icon('ph-duotone ph-chat-teardrop-dots');

  /**
   * Gets the user avatar icon.
   */
  public static readonly USER: Icon = new Icon('ph ph-user');

  /**
   * Gets the send-message icon.
   */
  public static readonly SEND: Icon = new Icon('ph-fill ph-paper-plane-right');

  // --- Settings ---

  /**
   * Gets the appearance (palette) settings-section icon.
   */
  public static readonly PALETTE: Icon = new Icon('ph ph-palette');

  /**
   * Gets the application settings-section icon.
   */
  public static readonly APPLICATION: Icon = new Icon('ph ph-app-window');

  /**
   * Gets the text-editor settings-section icon (regular weight keeps the settings nav uniform).
   */
  public static readonly SETTINGS_TEXT_EDITOR: Icon = new Icon('ph ph-file-code');

  /**
   * Gets the markdown settings-section icon (regular weight keeps the settings nav uniform).
   */
  public static readonly SETTINGS_MARKDOWN: Icon = new Icon('ph ph-markdown-logo');

  /**
   * Gets the keyboard settings-section icon (regular weight keeps the settings nav uniform).
   */
  public static readonly KEYBOARD: Icon = new Icon('ph ph-keyboard');

  /**
   * Gets the light-theme icon.
   */
  public static readonly THEME_LIGHT: Icon = new Icon('ph ph-sun');

  /**
   * Gets the dark-theme icon.
   */
  public static readonly THEME_DARK: Icon = new Icon('ph ph-moon');

  /**
   * Gets the system-theme icon.
   */
  public static readonly THEME_SYSTEM: Icon = new Icon('ph ph-monitor');

  // --- Welcome ---

  /**
   * Gets the recent-items icon.
   */
  public static readonly RECENT: Icon = new Icon('ph ph-clock-counter-clockwise');

  /**
   * Gets the thin recent-items glyph shown large in the recent-items empty state.
   */
  public static readonly RECENT_EMPTY: Icon = new Icon('ph-thin ph-clock-counter-clockwise');

  /**
   * Gets the light-weight directory icon shown on the welcome screen.
   */
  public static readonly WELCOME_DIRECTORY: Icon = new Icon('ph-light ph-folder-simple');

  /**
   * Gets the light-weight source-control icon shown on the welcome screen.
   */
  public static readonly WELCOME_SOURCE_CONTROL: Icon = new Icon('ph-light ph-git-branch');

  /**
   * Gets the light-weight project (cube) icon shown on the welcome screen.
   */
  public static readonly WELCOME_PROJECT: Icon = new Icon('ph-light ph-cube');

  /**
   * Gets the light-weight code icon shown on the welcome screen.
   */
  public static readonly WELCOME_CODE: Icon = new Icon('ph-light ph-brackets-curly');

  /**
   * Gets the light-weight markdown icon shown on the welcome screen.
   */
  public static readonly WELCOME_MARKDOWN: Icon = new Icon('ph-light ph-markdown-logo');

  /**
   * Gets the light-weight terminal icon shown on the welcome screen.
   */
  public static readonly WELCOME_TERMINAL: Icon = new Icon('ph-light ph-terminal-window');

  /**
   * Gets the light-weight Containers icon shown on the welcome screen.
   */
  public static readonly WELCOME_CONTAINERS: Icon = new Icon('ph-light ph-shipping-container');

  /**
   * Gets the light-weight agent icon shown on the welcome screen.
   */
  public static readonly WELCOME_AGENT: Icon = new Icon('ph-light ph-brain');

  /**
   * Gets the light-weight AI Model Manager icon shown on the welcome screen.
   */
  public static readonly WELCOME_AI_MODELS: Icon = new Icon('ph-light ph-cpu');

  /**
   * Gets the light-weight API Explorer icon shown on the welcome screen.
   */
  public static readonly WELCOME_API_EXPLORER: Icon = new Icon('ph-light ph-plugs-connected');

  /**
   * Gets the light-weight Database Explorer icon shown on the welcome screen.
   */
  public static readonly WELCOME_DATABASE: Icon = new Icon('ph-light ph-database');

  // --- Status bar ---

  /**
   * Gets the notches icon pinned to the trailing edge of the status bar.
   */
  public static readonly NOTCHES: Icon = new Icon('ph-bold ph-notches');

  // --- Shared affordances ---

  /**
   * Gets the split-layout (toggle layout) icon.
   */
  public static readonly LAYOUT_SPLIT: Icon = new Icon('ph ph-columns');

  /**
   * Gets the add (plus) icon.
   */
  public static readonly PLUS: Icon = new Icon('ph ph-plus');

  /**
   * Gets the delete (trash) icon.
   */
  public static readonly TRASH: Icon = new Icon('ph ph-trash');

  /**
   * Gets the select-all (double check) icon.
   */
  public static readonly SELECT_ALL: Icon = new Icon('ph ph-checks');

  /**
   * Gets the downward caret used on menus and split buttons.
   */
  public static readonly CARET_DOWN: Icon = new Icon('ph ph-caret-down');

  /**
   * Gets the bold downward caret, used on the document well's document-list menu button.
   */
  public static readonly CARET_DOWN_BOLD: Icon = new Icon('ph-bold ph-caret-down');

  /**
   * Gets the upward caret used on drop-up menus that open above their trigger.
   */
  public static readonly CARET_UP: Icon = new Icon('ph ph-caret-up');

  /**
   * Gets the leftward caret used on back navigation and collapsed nodes in right-to-left layouts.
   */
  public static readonly CARET_LEFT: Icon = new Icon('ph ph-caret-left');

  /**
   * Gets the rightward caret used on collapsed nodes.
   */
  public static readonly CARET_RIGHT: Icon = new Icon('ph ph-caret-right');

  /**
   * Gets the filled downward caret used on expanded tree nodes.
   */
  public static readonly CARET_DOWN_FILL: Icon = new Icon('ph-fill ph-caret-down');

  /**
   * Gets the filled upward caret used on expanded tree nodes that open above their trigger.
   */
  public static readonly CARET_UP_FILL: Icon = new Icon('ph-fill ph-caret-up');

  /**
   * Gets the filled leftward caret used on collapsed tree nodes in right-to-left layouts.
   */
  public static readonly CARET_LEFT_FILL: Icon = new Icon('ph-fill ph-caret-left');

  /**
   * Gets the filled rightward caret used on collapsed tree nodes.
   */
  public static readonly CARET_RIGHT_FILL: Icon = new Icon('ph-fill ph-caret-right');

  /**
   * Gets the plus-square glyph used to expand every node in a tree.
   */
  public static readonly PLUS_SQUARE: Icon = new Icon('ph ph-plus-square');

  /**
   * Gets the minus-square glyph used to collapse every node in a tree.
   */
  public static readonly MINUS_SQUARE: Icon = new Icon('ph ph-minus-square');

  /**
   * Gets the three-dots glyph used to open an overflow menu of further actions.
   */
  public static readonly DOTS_THREE: Icon = new Icon('ph ph-dots-three');

  /**
   * Gets the vertical three-dots glyph used for a row's overflow menu. Regular weight, as its
   * horizontal counterpart is: the same glyph turned on its side must not read as a heavier one.
   */
  public static readonly DOTS_THREE_VERTICAL: Icon = new Icon('ph ph-dots-three-vertical');

  /**
   * Initialises a new instance of the {@link Icon} class.
   * @param classList The CSS class list that renders the icon.
   */
  private constructor(public readonly classList: string) {}
}
