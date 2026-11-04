/**
 * What happens on macOS when the last window closes: Studio keeps running in the dock (the platform's
 * convention), or quits.
 */
export type QuitWhenLastWindowCloses = 'keep-running' | 'quit';

/**
 * How large the main window opens: as it was last left, at the default size centred on the screen,
 * or maximised.
 */
export type WindowSizeOnLaunch = 'remember' | 'default' | 'maximised';

/**
 * How the interface's corners are drawn. Automatic draws squircles when graphics acceleration is at
 * Full and rounded corners below it; the others fix the shape whatever the acceleration.
 */
export type CornerStyle = 'automatic' | 'squircle' | 'rounded' | 'square';

/**
 * When opening a link in the browser asks first: never, only for links from content Studio did not
 * write (agent output, Markdown, web and server content), or always.
 */
export type ConfirmExternalLinks = 'never' | 'untrusted' | 'always';

/**
 * Defines the settings the main process has to know before any window exists, or while none does.
 *
 * Settings live in the renderer's store, which the main process cannot reach at launch. Each of these
 * is mirrored to the main process whenever it changes (see `StartupSettingsMirror`), persisted beside
 * the other startup preferences, and handed back to every new window with the startup facts, so a
 * setting that shapes the first paint is in force before the renderer has read its own store.
 */
export interface StartupSettings {
  /**
   * Gets what happens on macOS when the last window closes.
   */
  readonly quitWhenLastWindowCloses: QuitWhenLastWindowCloses;

  /**
   * Gets how large the main window opens.
   */
  readonly windowSizeOnLaunch: WindowSizeOnLaunch;

  /**
   * Gets whether a window left in full screen opens in full screen again.
   */
  readonly restoreFullScreen: boolean;

  /**
   * Gets how the interface's corners are drawn, needed before the first paint so the corners never
   * change shape as the renderer starts.
   */
  readonly cornerStyle: CornerStyle;

  /**
   * Gets when opening a link in the browser asks first. The main process opens every link, including
   * the ones a page navigates to by itself, so it is the one that asks.
   */
  readonly confirmExternalLinks: ConfirmExternalLinks;

  /**
   * Gets whether the first write of a folder's `.studio` files adds the per-developer file to the
   * folder's `.gitignore`. The main process does the writing.
   */
  readonly addStudioUserFileToGitignore: boolean;

  /**
   * Gets how many folder levels are searched for .NET projects where there is no solution. The main
   * process builds the project model.
   */
  readonly projectScanDepth: number;
}

/**
 * Holds the startup settings in force before the renderer has mirrored any.
 */
export const DEFAULT_STARTUP_SETTINGS: StartupSettings = {
  quitWhenLastWindowCloses: 'keep-running',
  windowSizeOnLaunch: 'remember',
  restoreFullScreen: true,
  cornerStyle: 'automatic',
  confirmExternalLinks: 'never',
  addStudioUserFileToGitignore: true,
  projectScanDepth: 2,
};

/**
 * Picks a value from a closed set, falling back when the candidate is not one of them.
 * @param candidate The value read from an untrusted source.
 * @param allowed The values accepted.
 * @param fallback The value used otherwise.
 * @returns Returns the candidate when it is allowed, otherwise the fallback.
 */
function oneOf<T extends string>(candidate: unknown, allowed: readonly T[], fallback: T): T {
  return typeof candidate === 'string' && (allowed as readonly string[]).includes(candidate)
    ? (candidate as T)
    : fallback;
}

/**
 * Reads startup settings from an untrusted value (a persisted file, or a renderer's message), so a
 * hand-edited or corrupt entry degrades to its default rather than reaching the rest of the app.
 * @param raw The value to read.
 * @returns Returns fully populated startup settings.
 */
export function parseStartupSettings(raw: unknown): StartupSettings {
  const record: Record<string, unknown> =
    raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const defaults: StartupSettings = DEFAULT_STARTUP_SETTINGS;
  return {
    quitWhenLastWindowCloses: oneOf<QuitWhenLastWindowCloses>(
      record['quitWhenLastWindowCloses'],
      ['keep-running', 'quit'],
      defaults.quitWhenLastWindowCloses,
    ),
    windowSizeOnLaunch: oneOf<WindowSizeOnLaunch>(
      record['windowSizeOnLaunch'],
      ['remember', 'default', 'maximised'],
      defaults.windowSizeOnLaunch,
    ),
    restoreFullScreen:
      typeof record['restoreFullScreen'] === 'boolean'
        ? record['restoreFullScreen']
        : defaults.restoreFullScreen,
    cornerStyle: oneOf<CornerStyle>(
      record['cornerStyle'],
      ['automatic', 'squircle', 'rounded', 'square'],
      defaults.cornerStyle,
    ),
    confirmExternalLinks: oneOf<ConfirmExternalLinks>(
      record['confirmExternalLinks'],
      ['never', 'untrusted', 'always'],
      defaults.confirmExternalLinks,
    ),
    addStudioUserFileToGitignore:
      typeof record['addStudioUserFileToGitignore'] === 'boolean'
        ? record['addStudioUserFileToGitignore']
        : defaults.addStudioUserFileToGitignore,
    projectScanDepth:
      Number.isSafeInteger(record['projectScanDepth']) && (record['projectScanDepth'] as number) > 0
        ? (record['projectScanDepth'] as number)
        : defaults.projectScanDepth,
  };
}
