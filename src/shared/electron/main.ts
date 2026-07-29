import {
  app,
  BrowserWindow,
  Event as ElectronEvent,
  HandlerDetails,
  ipcMain,
  IpcMainEvent,
  IpcMainInvokeEvent,
  Menu,
  MenuItemConstructorOptions,
  shell,
  WebContents,
  WindowOpenHandlerResponse,
} from 'electron';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AppChannel } from '@shared/api/app-channels';
import { ShellChannel } from '@shared/api/shell-channels';
import { AUX_PANEL_URL, MODAL_WINDOW_URL, WindowChannel } from '@shared/api/window-channels';
import { AgentConversationStore } from './ai/agent-conversation-store';
import { AgentCategoryStore } from './ai/agent-category-store';
import { AiManager } from './ai/ai-manager';
import { CodeRunner } from '@shared/electron/code-runner';
import { BinaryDisassembler } from '@shared/electron/binary-disassembler';
import { BinaryAssembler } from '@shared/electron/binary-assembler';
import { DirectoryWatcher } from '@shared/electron/directory-watcher';
import { FileManager } from '@shared/electron/file-manager';
import { FileWatcher } from '@shared/electron/file-watcher';
import { Logger } from '@shared/electron/logger';
import { DebugAdapterRegistry } from './debug/debug-adapter-registry';
import { DebugLaunchResolver } from './debug/debug-launch-resolver';
import { DebugManager } from './debug/debug-manager';
import { projectSystems } from './project-system/default-project-systems';
import { DebugProvisioner } from './debug/debug-provisioner';
import { LspManager } from './lsp/lsp-manager';
import { LspServerRegistry } from './lsp/lsp-server-registry';
import { LspSettingsManager } from './lsp/lsp-settings';
import { MediaProtocol } from '@shared/electron/media-protocol';
import { openFilePathsFromArgv } from '@shared/electron/open-with-paths';
import { PrintManager } from '@shared/electron/print-manager';
import { SecurityManager } from '@shared/electron/security-manager';
import { hydrateLoginShellEnvironment } from '@shared/electron/shell-env';
import { StartupPreferences, StartupPreferencesStore } from './startup-preferences';
import { GitManager } from '@shared/electron/git-manager';
import { SearchManager } from '@shared/electron/search-manager';
import { StudioStore } from '@shared/electron/studio/studio-store';
import { WorktreeManager } from '@shared/electron/worktree/worktree-manager';
import { TerminalManager } from '@shared/electron/terminal-manager';
import { TrustedPaths } from './trusted-paths';
import { WindowManager } from '@shared/electron/window-manager';
import { WorkspaceContext } from './workspace-context';
import { WorkspaceManager } from './workspace-manager';

// Test seam: point userData at an isolated directory before anything resolves it (localStorage,
// trusted paths, agent conversations), so E2E runs never read or clobber the real app state.
const userDataOverride: string | undefined = process.env['STUDIO_USER_DATA_DIR'];
if (userDataOverride !== undefined) {
  app.setPath('userData', userDataOverride);
}

/**
 * Describes a single GPU device reported by {@link Electron.App.getGPUInfo}.
 */
interface GpuDevice {
  /**
   * Gets a value indicating whether this device is the one actively driving the renderer. Omitted by
   * some drivers.
   */
  readonly active?: boolean;

  /**
   * Gets the PCI vendor identifier of the device.
   */
  readonly vendorId?: number;
}

/**
 * Describes the subset of the `complete` GPU information reported by
 * {@link Electron.App.getGPUInfo} that the rendering recommendation relies on.
 */
interface GpuInfo {
  /**
   * Gets the GPU devices present on the system.
   */
  readonly gpuDevice?: GpuDevice[];

  /**
   * Gets the auxiliary GPU attributes, including the OpenGL renderer string used for the hint.
   */
  readonly auxAttributes?: {
    /**
     * Gets the OpenGL renderer string (for example, `Intel(R) UHD Graphics 630`).
     */
    readonly glRenderer?: string;
  };
}

class Program {
  /**
   * Specifies the development server URL to load. When undefined, the built Angular
   * application is loaded from disk instead (production behavior).
   */
  private static readonly START_URL: string | undefined = process.env['ELECTRON_START_URL'];

  /**
   * Specifies the absolute path to the built Angular entry point. The Angular
   * `application` builder emits to `dist/<project>/browser`. The compiled main
   * process lives at `dist-electron/electron/`, so the workspace root is two levels up.
   */
  private static readonly INDEX_HTML: string = path.join(
    __dirname,
    '..',
    '..',
    'dist',
    'onixlabs-studio',
    'browser',
    'index.html',
  );

  /**
   * Holds the URL schemes permitted to open in the operating system's default handler. Everything
   * else (file:, javascript:, etc.) is rejected.
   */
  private static readonly EXTERNAL_PROTOCOLS: readonly string[] = ['http:', 'https:', 'mailto:'];

  /**
   * Holds how long (ms) to wait for the renderer to answer a close request before closing anyway, so
   * an unresponsive renderer can never wedge the window permanently open.
   */
  private static readonly CLOSE_CONFIRM_TIMEOUT_MS: number = 30_000;

  /**
   * Holds the PCI vendor identifier for Intel GPUs. The active GPU's vendor decides the corner-shape
   * policy: Intel integrated GPUs (notably the UHD 630) corrupt the GPU-rasterized squircle corner
   * masks the UI uses, so the renderer falls back to plain rounded corners on them.
   */
  private static readonly INTEL_GPU_VENDOR_ID: number = 0x8086;

  /**
   * Maps known PCI vendor identifiers to human-readable names, used to describe the active GPU in the
   * settings hint when no OpenGL renderer string is available.
   */
  private static readonly GPU_VENDOR_NAMES: Readonly<Record<number, string>> = {
    0x8086: 'Intel GPU',
    0x10de: 'NVIDIA GPU',
    0x1002: 'AMD GPU',
    0x106b: 'Apple GPU',
  };

  /**
   * Holds how long (ms) to wait for GPU information before giving up and assuming a non-Intel GPU, so
   * a slow or stalled GPU process can never block window creation.
   */
  private static readonly GPU_INFO_TIMEOUT_MS: number = 3_000;

  /**
   * Owns every application window: creation, the registry resolving the main window that
   * renderer-push events target, and per-kind bounds persistence. The main window's lifecycle hooks
   * stay here (as options) because they drive the app-wide quit protocol.
   */
  private readonly windows: WindowManager = new WindowManager({
    preloadPath: path.join(__dirname, 'preload.js'),
    startUrl: Program.START_URL,
    indexHtml: Program.INDEX_HTML,
    applySecurity: (contents: WebContents): void => this.applyWebContentsSecurity(contents),
    onMainClose: (event: ElectronEvent): void => this.onWindowClose(event),
    onMainDidStartLoad: (): void => {
      // A (re)loading page has no listeners yet: OS-open paths queue again until the fresh renderer
      // drains them over TakePendingOpenPaths.
      this.openPathsReady = false;
      // The outgoing renderer's pop-outs and modals rendered from state that is about to go away
      // (both share its JS context), so they are closed rather than left dead. This runs at the
      // START of the load, before the incoming renderer opens windows of its own.
      this.windows.closeAllSecondaryWindows();
    },
  });

  /**
   * Holds a value indicating whether quitting has been confirmed (the renderer approved, or the
   * confirmation timed out). Once set, the window-close and before-quit handlers pass straight through.
   */
  private quitConfirmed: boolean = false;

  /**
   * Holds a value indicating whether a close confirmation round-trip is currently in flight, so the
   * window-close and before-quit paths share a single prompt rather than each starting their own.
   */
  private confirming: boolean = false;

  /**
   * Holds the GPU-derived rendering recommendation, resolved from the active GPU (or the
   * STUDIO_CORNERS override) at startup, before the window is created, and reported synchronously to
   * the preload on request. The renderer uses it to seed the "modern UI features" setting and its
   * hint when that setting is on its automatic mode.
   */
  private gpuRendering: { recommendReducedEffects: boolean; description: string } = {
    recommendReducedEffects: false,
    description: '',
  };

  /**
   * Holds whether GPU hardware acceleration is enabled for this launch, mirroring the persisted
   * startup preference so the preload can report it to the settings UI.
   */
  private hardwareAccelerationEnabled: boolean = true;

  /**
   * Holds the resolver for the in-flight close request, or null when none is pending.
   */
  private pendingClose: ((proceed: boolean) => void) | null = null;

  /**
   * Holds the file paths the operating system asked the application to open before the renderer was
   * ready to receive them (launch arguments, or open-file events during startup). Drained by the
   * renderer over {@link AppChannel.TakePendingOpenPaths} once it is listening.
   */
  private readonly pendingOpenPaths: string[] = [];

  /**
   * Holds a value indicating whether the renderer has drained the pending open paths and is ready to
   * receive direct open-path pushes. Reset whenever the page (re)loads, since a reloading renderer
   * loses its listeners and must drain again.
   */
  private openPathsReady: boolean = false;

  /**
   * Manages pseudo-terminal sessions on behalf of the renderer.
   */
  private readonly terminalManager: TerminalManager = new TerminalManager(
    (): BrowserWindow | null => this.windows.main(),
  );

  /**
   * Handles file-system operations and dialogs on behalf of the renderer.
   */
  /**
   * Remembers paths the user has opened through a dialog so recent items can be re-opened without
   * weakening the workspace confinement.
   */
  private readonly trustedPaths: TrustedPaths = new TrustedPaths(
    path.join(app.getPath('userData'), 'trusted-paths.json'),
  );

  private readonly fileManager: FileManager = new FileManager(
    (): BrowserWindow | null => this.windows.main(),
    this.trustedPaths,
  );

  /**
   * Writes editor content to temporary files so the renderer can execute it.
   */
  private readonly codeRunner: CodeRunner = new CodeRunner();

  /**
   * Runs git safely on behalf of the renderer's source-control surfaces.
   */
  private readonly gitManager: GitManager = new GitManager((): BrowserWindow | null =>
    this.windows.main(),
  );

  /**
   * Watches open documents on disk and notifies the renderer when they change.
   */
  private readonly fileWatcher: FileWatcher = new FileWatcher((): BrowserWindow | null =>
    this.windows.main(),
  );

  /**
   * Watches directory trees on disk and notifies the renderer when their entries change, feeding the
   * explorers' live refresh and the source-control view's automatic git status.
   */
  private readonly directoryWatcher: DirectoryWatcher = new DirectoryWatcher(
    (): BrowserWindow | null => this.windows.main(),
  );

  /**
   * Owns the AI agent subsystem: authentication, provider runtime, and event streaming.
   */
  private readonly aiManager: AiManager = new AiManager((): BrowserWindow | null =>
    this.windows.main(),
  );

  /**
   * Owns the runtime security policy: the Content-Security-Policy header and the image-source policy.
   */
  private readonly securityManager: SecurityManager = new SecurityManager();

  /**
   * Serves local image files to the markdown editor over the custom media protocol.
   */
  private readonly mediaProtocol: MediaProtocol = new MediaProtocol();

  /**
   * Exports the current document to a PDF on behalf of the renderer's editors.
   */
  private readonly printManager: PrintManager = new PrintManager();

  /**
   * Tracks the open workspace root and confines filesystem operations to it.
   */
  private readonly workspaceContext: WorkspaceContext = new WorkspaceContext();

  /**
   * Reads and writes each workspace's `.studio` persistence, confined to the open workspace roots the
   * {@link workspaceContext} tracks.
   */
  private readonly studioStore: StudioStore = new StudioStore(this.workspaceContext);

  /**
   * Handles workspace (open folder) and directory operations on behalf of the renderer.
   */
  private readonly workspaceManager: WorkspaceManager = new WorkspaceManager(
    (): BrowserWindow | null => this.windows.main(),
    this.workspaceContext,
    this.trustedPaths,
  );

  /**
   * Handles worktree-container operations (kind resolution, promotion, checkout add/remove) on
   * behalf of the renderer, confined to trusted paths and the open workspace roots.
   */
  private readonly worktreeManager: WorktreeManager = new WorktreeManager(
    this.workspaceContext,
    this.trustedPaths,
  );

  /**
   * Runs workspace text searches by shelling out to the bundled ripgrep binary, confined to the open
   * workspace roots the {@link workspaceContext} tracks.
   */
  private readonly searchManager: SearchManager = new SearchManager(this.workspaceContext);

  /**
   * Writes application log lines — the renderer's forwarded console entries and main's own — to
   * stdout in development and to rotating files under `userData/logs` in packaged builds.
   */
  private readonly logger: Logger = new Logger();

  /**
   * Disassembles native machine code for the binary/hex editor. It decodes bytes the renderer sends
   * (already obtained through the gated byte-read channel), so it needs no disk access of its own.
   */
  private readonly binaryDisassembler: BinaryDisassembler = new BinaryDisassembler();

  /**
   * Assembles machine code for the binary/hex editor's agent, the write-side counterpart to the
   * disassembler. It turns assembly text the renderer sends into bytes, needing no disk access of its
   * own.
   */
  private readonly binaryAssembler: BinaryAssembler = new BinaryAssembler();

  /**
   * Owns the user's language-server settings (disabled servers, runtime overrides).
   */
  private readonly lspSettingsManager: LspSettingsManager = new LspSettingsManager();

  /**
   * Owns the user's persisted agent conversations, scoped by context (workspace/repository/file/global).
   */
  private readonly agentConversationStore: AgentConversationStore = new AgentConversationStore();

  /**
   * Owns the user's conversation categories — the organisation layer over conversation history.
   */
  private readonly agentCategoryStore: AgentCategoryStore = new AgentCategoryStore();

  /**
   * Resolves language-server identifiers into spawn specifications for the {@link LspManager}.
   */
  private readonly lspServerRegistry: LspServerRegistry = new LspServerRegistry(
    process.execPath,
    this.lspSettingsManager,
  );

  /**
   * Owns language-server sessions: spawns servers, runs the LSP handshake, and bridges diagnostics
   * and language features to the renderer.
   */
  private readonly lspManager: LspManager = new LspManager(
    (): BrowserWindow | null => this.windows.main(),
    this.workspaceContext,
    this.lspServerRegistry,
  );

  /**
   * Resolves debug-adapter identifiers into spawn specifications for the {@link DebugManager}, locating
   * each adapter's executable.
   */
  private readonly debugAdapterRegistry: DebugAdapterRegistry = new DebugAdapterRegistry(
    new DebugProvisioner(
      new Map<string, string>(),
      path.join(app.getPath('userData'), 'debug-adapters'),
    ),
  );

  /**
   * Owns debug-adapter sessions: spawns adapters, runs the DAP handshake, and bridges the adapter's
   * events and the renderer's requests.
   */
  private readonly debugManager: DebugManager = new DebugManager(
    (): BrowserWindow | null => this.windows.main(),
    this.workspaceContext,
    this.debugAdapterRegistry,
  );

  /**
   * Resolves a run configuration into a concrete debug launch target (building the project and locating
   * its artifact for compiled ecosystems), confined to the open workspace root.
   */
  private readonly debugLaunchResolver: DebugLaunchResolver = new DebugLaunchResolver(
    projectSystems,
    this.workspaceContext,
  );

  /**
   * Initializes a new instance of the Program class.
   */
  private constructor() {
    this.initialize();
  }

  /**
   * Initializes the current Program instance.
   */
  private initialize(): void {
    // DIAGNOSTIC: two escape hatches for machine-specific GPU rendering artifacts (e.g. corrupted
    // right/bottom borders and jagged squircle/box-shadow edges on the welcome panel under fractional
    // display scaling on the Intel UHD 630). Both must be set before app.whenReady().
    //
    //   STUDIO_DISABLE_GPU_RASTER=1 — keeps GPU compositing but moves rasterization to the CPU. This
    //     is the lighter-touch fix: it targets the squircle/border raster artifacts directly while
    //     retaining hardware-accelerated compositing. Try this first.
    //   STUDIO_DISABLE_GPU=1 — disables hardware acceleration entirely (full software rendering). The
    //     blunt instrument; use only to confirm the GPU is the cause.
    if (process.env['STUDIO_DISABLE_GPU_RASTER'] === '1') {
      app.commandLine.appendSwitch('disable-gpu-rasterization');
      console.warn('[diagnostic] GPU rasterization disabled (STUDIO_DISABLE_GPU_RASTER=1)');
    }
    // Hardware acceleration can only be toggled before the app is ready. The user preference is read
    // synchronously from the startup-preferences file (the renderer's settings store is unreachable
    // this early), and the STUDIO_DISABLE_GPU diagnostic switch forces it off regardless.
    const startupPreferences: StartupPreferences = StartupPreferencesStore.read();
    this.hardwareAccelerationEnabled = startupPreferences.hardwareAcceleration;
    if (!startupPreferences.hardwareAcceleration || process.env['STUDIO_DISABLE_GPU'] === '1') {
      app.disableHardwareAcceleration();
      console.warn('[startup] GPU hardware acceleration disabled');
    }

    // A privileged scheme must be declared before the app is ready, so the media protocol's scheme is
    // registered here; its request handler is installed once ready (see registerIpcHandlers).
    MediaProtocol.registerScheme();

    // File-type associations route through a single instance: a second launch (double-clicking a
    // file while the app runs on Windows/Linux) forwards its arguments here and exits.
    if (!app.requestSingleInstanceLock()) {
      app.quit();
      return;
    }
    app.on('second-instance', (_event: ElectronEvent, argv: string[]): void =>
      this.onSecondInstance(argv),
    );
    // macOS delivers OS-opened files as open-file events (never argv). Registered before the app is
    // ready so a double-click that launches the app is captured and queued for the renderer.
    app.on('open-file', (event: ElectronEvent, filePath: string): void => {
      event.preventDefault();
      this.dispatchOpenPath(filePath);
    });

    void app.whenReady().then(this.onReady.bind(this));
  }

  /**
   * Handles a second application instance launching (a Windows/Linux file association or a repeat
   * launch): opens any files its command line names and brings the existing window to the front.
   * @param argv The second instance's command-line arguments.
   */
  private onSecondInstance(argv: string[]): void {
    for (const filePath of openFilePathsFromArgv(argv, process.defaultApp === true)) {
      this.dispatchOpenPath(filePath);
    }
    this.windows.focusMain();
  }

  /**
   * Routes a file path the operating system asked the application to open: verifies it names a real
   * file, remembers it as user-vouched (the OS action is equivalent to picking it in an open dialog,
   * and the confined read path honours only trusted or in-workspace files), and hands it to the
   * renderer — directly when it is listening, otherwise queued until it drains the pending set.
   * @param filePath The absolute path the operating system supplied.
   */
  private dispatchOpenPath(filePath: string): void {
    try {
      if (!fs.statSync(filePath).isFile()) {
        return;
      }
    } catch {
      return;
    }
    this.trustedPaths.remember(filePath);
    const window: BrowserWindow | null = this.windows.main();
    if (this.openPathsReady && window !== null && !window.isDestroyed()) {
      window.webContents.send(AppChannel.OpenPath, filePath);
      return;
    }
    this.pendingOpenPaths.push(filePath);
  }

  /**
   * Registers the IPC handlers for renderer-initiated window control requests. Each handler
   * resolves the window from the request sender so it always acts on the requesting window.
   */
  private registerIpcHandlers(): void {
    ipcMain.on(WindowChannel.Minimize, (event: IpcMainEvent): void => {
      BrowserWindow.fromWebContents(event.sender)?.minimize();
    });

    ipcMain.on(WindowChannel.ToggleMaximize, (event: IpcMainEvent): void => {
      const targetWindow: BrowserWindow | null = BrowserWindow.fromWebContents(event.sender);
      if (targetWindow === null) {
        return;
      }

      if (targetWindow.isMaximized()) {
        targetWindow.unmaximize();
      } else {
        targetWindow.maximize();
      }
    });

    ipcMain.on(WindowChannel.Close, (event: IpcMainEvent): void => {
      BrowserWindow.fromWebContents(event.sender)?.close();
    });

    ipcMain.on(WindowChannel.Show, (event: IpcMainEvent): void => {
      this.windows.claimMainPresence();
      const targetWindow: BrowserWindow | null = BrowserWindow.fromWebContents(event.sender);
      if (targetWindow !== null) {
        this.windows.showWindow(targetWindow);
      }
    });

    ipcMain.on(WindowChannel.Hide, (event: IpcMainEvent): void => {
      this.windows.claimMainPresence();
      BrowserWindow.fromWebContents(event.sender)?.hide();
    });

    ipcMain.on(WindowChannel.SetMovable, (event: IpcMainEvent, movable: unknown): void => {
      if (typeof movable !== 'boolean') {
        return;
      }

      BrowserWindow.fromWebContents(event.sender)?.setMovable(movable);
    });

    ipcMain.on(AppChannel.ConfirmClose, (_event: IpcMainEvent, proceed: unknown): void => {
      this.resolveClose(proceed === true);
    });

    ipcMain.on(AppChannel.GetDisplayStartup, (event: IpcMainEvent): void => {
      // Synchronous: every value was resolved before the window (and thus this preload) was created.
      event.returnValue = {
        gpuRendering: this.gpuRendering,
        hardwareAccelerationEnabled: this.hardwareAccelerationEnabled,
        homeDir: os.homedir(),
      };
    });

    ipcMain.handle(
      AppChannel.SetHardwareAcceleration,
      (_event: IpcMainInvokeEvent, enabled: unknown): void => {
        if (typeof enabled !== 'boolean') {
          return;
        }
        StartupPreferencesStore.write({ hardwareAcceleration: enabled });
      },
    );

    ipcMain.handle(AppChannel.TakePendingOpenPaths, (): string[] => {
      this.openPathsReady = true;
      return this.pendingOpenPaths.splice(0, this.pendingOpenPaths.length);
    });

    ipcMain.on(AppChannel.Relaunch, (): void => {
      // Relaunch then quit through the normal close path, so the renderer's unsaved-work confirmation
      // still runs before the process exits.
      app.relaunch();
      app.quit();
    });

    ipcMain.handle(
      ShellChannel.OpenPath,
      (_event: IpcMainInvokeEvent, target: unknown): Promise<string> =>
        typeof target === 'string' && target.length > 0
          ? shell.openPath(target)
          : Promise.resolve('Invalid path'),
    );

    ipcMain.handle(
      ShellChannel.OpenExternal,
      (_event: IpcMainInvokeEvent, url: unknown): Promise<void> => this.openExternalUrl(url),
    );

    ipcMain.handle(ShellChannel.RevealPath, (_event: IpcMainInvokeEvent, target: unknown): void => {
      if (typeof target === 'string' && target.length > 0) {
        shell.showItemInFolder(target);
      }
    });

    this.logger.register();
    this.securityManager.register();
    this.mediaProtocol.register();
    this.printManager.register();
    this.terminalManager.register();
    this.fileManager.register();
    this.codeRunner.register();
    this.gitManager.register();
    this.workspaceManager.register();
    this.searchManager.register();
    this.studioStore.register();
    this.worktreeManager.register();
    this.binaryDisassembler.register();
    this.binaryAssembler.register();
    this.fileWatcher.register();
    this.directoryWatcher.register();
    this.aiManager.register();
    this.agentConversationStore.register();
    this.agentCategoryStore.register();
    this.lspSettingsManager.register();
    this.lspManager.register();
    this.debugManager.register();
    this.debugLaunchResolver.register();
  }

  /**
   * Hardens a window's web contents: navigation away from the app shell is blocked (external URLs are
   * routed to the system browser instead), and the renderer is never allowed to open new windows.
   * @param contents The web contents to guard.
   */
  private applyWebContentsSecurity(contents: WebContents): void {
    contents.on('will-navigate', (event: ElectronEvent, url: string): void => {
      if (this.isInternalNavigation(url)) {
        return;
      }
      event.preventDefault();
      void this.openExternalUrl(url);
    });

    contents.setWindowOpenHandler((details: HandlerDetails): WindowOpenHandlerResponse => {
      // The two allowed window.open targets, both same-renderer children the opener scripts
      // directly: an auxiliary panel window (a dock panel popping out with its services intact) and
      // a modal window (one dialog over the window that raised it). Neither carries navigable
      // content of its own, both inherit this window's hardened webPreferences, and both are
      // adopted below (guards, registry, bounds). Everything else stays denied (#116).
      if (details.url === AUX_PANEL_URL) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: this.windows.auxiliaryWindowOptions(details.features),
        };
      }
      if (details.url === MODAL_WINDOW_URL) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: this.windows.modalWindowOptions(
            details.features,
            BrowserWindow.fromWebContents(contents),
          ),
        };
      }
      void this.openExternalUrl(details.url);
      return { action: 'deny' };
    });

    contents.on(
      'did-create-window',
      (window: BrowserWindow, details: Electron.DidCreateWindowDetails): void => {
        if (details.url === MODAL_WINDOW_URL) {
          this.windows.adoptModalWindow(window);
        } else {
          this.windows.adoptAuxiliaryWindow(window);
        }
      },
    );
  }

  /**
   * Determines whether a navigation target is the app shell itself (its dev server origin, or the
   * packaged file). Any other target is treated as off-shell navigation and blocked.
   * @param target The navigation target URL.
   * @returns Returns true when the target is the app shell.
   */
  private isInternalNavigation(target: string): boolean {
    let parsed: URL;
    try {
      parsed = new URL(target);
    } catch {
      return false;
    }
    if (Program.START_URL !== undefined) {
      return parsed.origin === new URL(Program.START_URL).origin;
    }
    return parsed.protocol === 'file:';
  }

  /**
   * Returns the URL when it is a safe external URL to hand to the operating system, or null when it is
   * not a string, not a valid URL, or uses a disallowed scheme.
   * @param url The candidate URL.
   * @returns Returns the URL when safe to open externally; otherwise, null.
   */
  private safeExternalUrl(url: unknown): string | null {
    if (typeof url !== 'string') {
      return null;
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    return Program.EXTERNAL_PROTOCOLS.includes(parsed.protocol) ? url : null;
  }

  /**
   * Opens a URL in the operating system's default browser when it is a safe external URL; otherwise
   * does nothing.
   * @param url The candidate URL.
   * @returns Returns a promise that resolves once the URL has been opened (or rejected).
   */
  private async openExternalUrl(url: unknown): Promise<void> {
    const safe: string | null = this.safeExternalUrl(url);
    if (safe !== null) {
      await shell.openExternal(safe);
    }
  }

  /**
   * Installs the application menu: the default menu minus the View menu's zoom items (Zoom In,
   * Zoom Out, Actual Size). Page zoom is disabled in the application — the UI is designed for a
   * fixed scale, and the editors provide their own content zoom — so the menu omits the zoom roles,
   * which also unregisters their Cmd/Ctrl+=, - and 0 accelerators.
   */
  private installApplicationMenu(): void {
    const template: MenuItemConstructorOptions[] = [];
    if (process.platform === 'darwin') {
      template.push({ role: 'appMenu' });
    }
    template.push(
      { role: 'fileMenu' },
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'forceReload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
      { role: 'windowMenu' },
    );
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }

  /**
   * Handles the app whenReady event.
   */
  private async onReady(): Promise<void> {
    this.installApplicationMenu();
    this.registerIpcHandlers();
    // Resolve the GPU rendering recommendation before the window exists, so the value is ready when
    // the renderer's preload reads it synchronously (before the first paint).
    await this.resolveGpuRenderingRecommendation();
    this.windows.createMainWindow();
    // Windows/Linux deliver OS-opened files as launch arguments (macOS sends open-file events,
    // handled in initialize); queue them for the renderer to drain once it is listening.
    for (const filePath of openFilePathsFromArgv(process.argv, process.defaultApp === true)) {
      this.dispatchOpenPath(filePath);
    }
    app.on('activate', this.onActivate.bind(this));
    app.on('window-all-closed', this.onWindowAllClosed.bind(this));
    app.on('before-quit', this.onBeforeQuit.bind(this));
    // Tear down on will-quit (the final stage) rather than before-quit, so the renderer's save/confirm
    // round-trip runs against a fully-alive subsystem before anything is disposed.
    app.on('will-quit', (): void => this.disposeAll());
  }

  /**
   * Resolves the GPU rendering recommendation reported to the renderer. The recommendation follows
   * the active GPU, since some GPUs (notably the Intel UHD 630) corrupt the GPU-rasterized squircle
   * corner masks the UI uses; the STUDIO_CORNERS environment variable overrides it (`round` forces a
   * reduced recommendation, `squircle` forces the full one). Stored on the instance for the
   * synchronous preload handler to read.
   */
  private async resolveGpuRenderingRecommendation(): Promise<void> {
    const info: GpuInfo | null = await this.getGpuInfoWithTimeout();
    const description: string = this.describeGpu(info);
    let recommendReducedEffects: boolean = this.activeGpuIsIntel(info);

    const override: string | undefined = process.env['STUDIO_CORNERS'];
    if (override === 'round' || override === 'squircle') {
      recommendReducedEffects = override === 'round';
      console.warn(`[startup] rendering recommendation forced to '${override}' (STUDIO_CORNERS)`);
    } else if (recommendReducedEffects) {
      console.warn(`[startup] weak GPU detected ('${description}'); recommending reduced effects`);
    }

    this.gpuRendering = { recommendReducedEffects, description };
  }

  /**
   * Determines whether the GPU currently driving the renderer is an Intel GPU. Prefers the device
   * flagged active; when none is flagged (some drivers omit it), falls back to whether any Intel GPU
   * is present, since Chromium renders on the integrated GPU by default on dual-GPU Macs.
   * @param info The GPU information, or null when it could not be obtained.
   * @returns Returns true when the active GPU is an Intel GPU.
   */
  private activeGpuIsIntel(info: GpuInfo | null): boolean {
    const devices: GpuDevice[] = info?.gpuDevice ?? [];
    if (devices.length === 0) {
      return false;
    }
    const active: GpuDevice | undefined = devices.find(
      (device: GpuDevice): boolean => device.active === true,
    );
    if (active !== undefined) {
      return active.vendorId === Program.INTEL_GPU_VENDOR_ID;
    }
    return devices.some(
      (device: GpuDevice): boolean => device.vendorId === Program.INTEL_GPU_VENDOR_ID,
    );
  }

  /**
   * Builds a human-readable description of the active GPU for the settings hint, preferring the
   * OpenGL renderer string and falling back to a vendor name derived from the active device.
   * @param info The GPU information, or null when it could not be obtained.
   * @returns Returns the GPU description, or an empty string when it could not be identified.
   */
  private describeGpu(info: GpuInfo | null): string {
    const glRenderer: string | undefined = info?.auxAttributes?.glRenderer;
    if (typeof glRenderer === 'string' && glRenderer.trim().length > 0) {
      return glRenderer.trim();
    }
    const devices: GpuDevice[] = info?.gpuDevice ?? [];
    const device: GpuDevice | undefined =
      devices.find((candidate: GpuDevice): boolean => candidate.active === true) ?? devices[0];
    return device !== undefined ? (Program.GPU_VENDOR_NAMES[device.vendorId ?? 0] ?? '') : '';
  }

  /**
   * Fetches GPU information, racing it against a timeout so a slow or stalled GPU process can never
   * wedge window creation. Resolves null when the timeout wins or the lookup fails.
   * @returns Returns the GPU information, or null on timeout or error.
   */
  private getGpuInfoWithTimeout(): Promise<GpuInfo | null> {
    const gpuInfo: Promise<GpuInfo | null> = (app.getGPUInfo('complete') as Promise<GpuInfo>).catch(
      (): null => null,
    );
    const timeout: Promise<null> = new Promise<null>((resolve: (value: null) => void): void => {
      setTimeout((): void => resolve(null), Program.GPU_INFO_TIMEOUT_MS);
    });
    return Promise.race([gpuInfo, timeout]);
  }

  /**
   * Disposes every subsystem that owns OS resources. Called once at shutdown.
   */
  private disposeAll(): void {
    this.terminalManager.disposeAll();
    this.codeRunner.dispose();
    this.fileWatcher.disposeAll();
    this.directoryWatcher.disposeAll();
    this.aiManager.disposeAll();
    this.lspManager.disposeAll();
    this.debugManager.disposeAll();
  }

  /**
   * Intercepts a window close (the OS close button or the in-app close command), holding it until the
   * renderer confirms it is safe to quit. Once confirmed, the close passes straight through.
   * @param event The close event, prevented while confirmation is sought.
   */
  private onWindowClose(event: ElectronEvent): void {
    if (this.quitConfirmed) {
      return;
    }
    event.preventDefault();
    void this.beginQuit();
  }

  /**
   * Intercepts an application quit (Cmd+Q, the menu, or a programmatic quit), holding it until the
   * renderer confirms it is safe to quit. Once confirmed, the quit passes straight through.
   * @param event The before-quit event, prevented while confirmation is sought.
   */
  private onBeforeQuit(event: ElectronEvent): void {
    if (this.quitConfirmed) {
      return;
    }
    event.preventDefault();
    void this.beginQuit();
  }

  /**
   * Runs the close-confirmation round-trip once (shared by the window-close and before-quit paths) and,
   * on approval, quits the application — which then tears down on will-quit. A cancellation leaves the
   * window open.
   * @returns Returns a promise that resolves once the decision has been handled.
   */
  private async beginQuit(): Promise<void> {
    if (this.confirming) {
      return;
    }
    this.confirming = true;
    const proceed: boolean = await this.requestRendererClose();
    this.confirming = false;
    if (proceed) {
      this.quitConfirmed = true;
      app.quit();
    }
  }

  /**
   * Sends a close request to the renderer and resolves with its decision, defaulting to quitting when
   * no window is available or the renderer does not answer in time.
   * @returns Returns true when the application may quit.
   */
  private requestRendererClose(): Promise<boolean> {
    const window: BrowserWindow | null = this.windows.main();
    if (window === null) {
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve: (proceed: boolean) => void): void => {
      const timer: NodeJS.Timeout = setTimeout((): void => {
        this.pendingClose = null;
        resolve(true);
      }, Program.CLOSE_CONFIRM_TIMEOUT_MS);
      this.pendingClose = (proceed: boolean): void => {
        clearTimeout(timer);
        resolve(proceed);
      };
      window.webContents.send(AppChannel.RequestClose);
    });
  }

  /**
   * Resolves the in-flight close request with the renderer's decision.
   * @param proceed True when the window may close.
   */
  private resolveClose(proceed: boolean): void {
    const resolver: ((proceed: boolean) => void) | null = this.pendingClose;
    this.pendingClose = null;
    resolver?.(proceed);
  }

  /**
   * Handles the app onActivate event.
   */
  private onActivate(): void {
    if (this.windows.main() === null) this.windows.createMainWindow();
  }

  /**
   * Handles the app onWindowAllClosed event.
   */
  private onWindowAllClosed(): void {
    if (process.platform !== 'darwin') app.quit();
  }

  /**
   * Runs the program.
   */
  public static run(): void {
    // A GUI launch inherits only launchd's minimal environment and never sources the user's shell
    // profile, so exports such as `GITHUB_TOKEN` and an enriched `PATH` would be missing from the
    // agent's Bash and the terminal. Hydrate `process.env` before any manager reads it (the managers
    // resolve their env lazily at spawn time, and this runs ahead of every field initializer).
    hydrateLoginShellEnvironment();
    new Program();
  }
}

Program.run();
