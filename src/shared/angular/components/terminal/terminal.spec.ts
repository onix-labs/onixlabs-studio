import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { Bridge } from '@shared/api/bridge';
import { ShellChannel } from '@shared/api/shell-channels';
import { TerminalChannel, TerminalReplay } from '@shared/api/terminal-channels';
import { Settings } from '@shared/angular/services/settings/settings';
import { TerminalConfirmation } from '@shared/angular/services/terminal-confirmation/terminal-confirmation';
import {
  TERMINAL_PATH_LINKS,
  TerminalPathLinks,
} from '@shared/angular/services/terminal-path-links/terminal-path-links';
import { Terminals } from '@shared/angular/services/terminals/terminals';
import { Theme } from '@shared/angular/services/theme/theme';
import { Terminal, TerminalExit } from './terminal';

/**
 * Names the factories the module mocks call.
 */
interface ModuleHooks {
  xterm(options: unknown): unknown;
  fit(): unknown;
  search(): unknown;
  webgl(): unknown;
}

/**
 * Holds the factories the module mocks call. Hoisted so the mocks can see them; filled in below, where
 * the fakes can be ordinary classes.
 */
const hooks: ModuleHooks = vi.hoisted((): ModuleHooks => ({
  xterm: (): unknown => undefined,
  fit: (): unknown => undefined,
  search: (): unknown => undefined,
  webgl: (): unknown => undefined,
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    public constructor(options: unknown) {
      return hooks.xterm(options) as this;
    }
  },
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    public constructor() {
      return hooks.fit() as this;
    }
  },
}));

vi.mock('@xterm/addon-search', () => ({
  SearchAddon: class {
    public constructor() {
      return hooks.search() as this;
    }
  },
}));

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class {
    public constructor() {
      return hooks.webgl() as this;
    }
  },
}));

/**
 * A listener a fake raises events on.
 */
type Listener<T> = (value: T) => void;

/**
 * A subscribable event, as xterm exposes them.
 */
class FakeEvent<T> {
  private readonly listeners: Set<Listener<T>> = new Set<Listener<T>>();

  public readonly subscribe: (listener: Listener<T>) => { dispose(): void } = (
    listener: Listener<T>,
  ): { dispose(): void } => {
    this.listeners.add(listener);
    return { dispose: (): boolean => this.listeners.delete(listener) };
  };

  public fire(value: T): void {
    for (const listener of [...this.listeners]) {
      listener(value);
    }
  }
}

/**
 * A row of the fake buffer.
 */
class FakeRow {
  public readonly length: number;

  public constructor(
    private readonly text: string,
    public readonly isWrapped: boolean = false,
  ) {
    this.length = text.length;
  }

  public translateToString(): string {
    return this.text;
  }

  public getCell(x: number): { getChars(): string; getWidth(): number } | undefined {
    return x < this.text.length
      ? { getChars: (): string => this.text.charAt(x), getWidth: (): number => 1 }
      : undefined;
  }
}

/**
 * The fake's active buffer: rows of text and where the viewport sits.
 */
class FakeActiveBuffer {
  public readonly type: string = 'normal';
  public readonly baseY: number = 0;
  public readonly cursorY: number = 0;
  public viewportY: number = 0;
  public rowsOfText: FakeRow[] = [];

  public get length(): number {
    return this.rowsOfText.length;
  }

  public getLine(index: number): FakeRow | undefined {
    return this.rowsOfText[index];
  }
}

/**
 * A fake xterm: records what it was told, and raises the events a user or the renderer would.
 */
class FakeXterm {
  public readonly options: Record<string, unknown>;
  public readonly cols: number = 80;
  public readonly rows: number = 24;
  public readonly written: string[] = [];
  public readonly pasted: string[] = [];
  public readonly addons: unknown[] = [];
  public readonly scrolledTo: number[] = [];
  public element: HTMLElement | undefined = undefined;
  public opened: HTMLElement | undefined = undefined;
  public focusCount: number = 0;
  public clearCount: number = 0;
  public scrollToBottomCount: number = 0;
  public disposed: boolean = false;
  public selection: string = '';
  public keyHandler: ((event: KeyboardEvent) => boolean) | undefined = undefined;
  public linkProvider:
    | { provideLinks(line: number, callback: (links: unknown[] | undefined) => void): void }
    | undefined = undefined;

  public readonly data: FakeEvent<string> = new FakeEvent<string>();
  public readonly title: FakeEvent<string> = new FakeEvent<string>();
  public readonly selectionChange: FakeEvent<void> = new FakeEvent<void>();
  public readonly bell: FakeEvent<void> = new FakeEvent<void>();
  public readonly scroll: FakeEvent<number> = new FakeEvent<number>();
  public readonly writeParsed: FakeEvent<void> = new FakeEvent<void>();
  public readonly resized: FakeEvent<void> = new FakeEvent<void>();
  public readonly bufferChange: FakeEvent<void> = new FakeEvent<void>();

  public readonly onData: FakeEvent<string>['subscribe'] = this.data.subscribe;
  public readonly onTitleChange: FakeEvent<string>['subscribe'] = this.title.subscribe;
  public readonly onSelectionChange: FakeEvent<void>['subscribe'] = this.selectionChange.subscribe;
  public readonly onBell: FakeEvent<void>['subscribe'] = this.bell.subscribe;
  public readonly onScroll: FakeEvent<number>['subscribe'] = this.scroll.subscribe;
  public readonly onWriteParsed: FakeEvent<void>['subscribe'] = this.writeParsed.subscribe;
  public readonly onResize: FakeEvent<void>['subscribe'] = this.resized.subscribe;

  public readonly active: FakeActiveBuffer = new FakeActiveBuffer();

  public readonly buffer: unknown = {
    onBufferChange: this.bufferChange.subscribe,
    active: this.active,
  };

  public constructor(options: Record<string, unknown>) {
    this.options = { ...options };
  }

  public loadAddon(addon: unknown): void {
    this.addons.push(addon);
  }

  public open(host: HTMLElement): void {
    this.opened = host;
    this.element = document.createElement('div');
    const screen: HTMLElement = document.createElement('div');
    screen.className = 'xterm-screen';
    this.element.append(screen);
    host.append(this.element);
  }

  public write(data: string, callback?: () => void): void {
    this.written.push(data);
    callback?.();
  }

  public writeln(data: string): void {
    this.written.push(`${data}\n`);
  }

  public paste(text: string): void {
    this.pasted.push(text);
  }

  public focus(): void {
    this.focusCount += 1;
  }

  public clear(): void {
    this.clearCount += 1;
  }

  public scrollToBottom(): void {
    this.scrollToBottomCount += 1;
  }

  public scrollToLine(line: number): void {
    this.scrolledTo.push(line);
  }

  public hasSelection(): boolean {
    return this.selection.length > 0;
  }

  public getSelection(): string {
    return this.selection;
  }

  public attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void {
    this.keyHandler = handler;
  }

  public registerLinkProvider(provider: FakeXterm['linkProvider']): void {
    this.linkProvider = provider;
  }

  public registerMarker(): undefined {
    return undefined;
  }

  public registerDecoration(): undefined {
    return undefined;
  }

  public dispose(): void {
    this.disposed = true;
    this.opened?.replaceChildren();
  }
}

/**
 * A fake fit addon, counting fits.
 */
class FakeFit {
  public fits: number = 0;
  public failure: Error | undefined = undefined;

  public fit(): void {
    if (this.failure !== undefined) {
      throw this.failure;
    }
    this.fits += 1;
  }
}

/**
 * A fake search addon, recording what it was asked to find.
 */
class FakeSearch {
  public readonly calls: string[] = [];
  public cleared: number = 0;
  public readonly results: FakeEvent<{ resultIndex: number; resultCount: number }> = new FakeEvent<{
    resultIndex: number;
    resultCount: number;
  }>();
  public readonly onDidChangeResults: FakeEvent<{
    resultIndex: number;
    resultCount: number;
  }>['subscribe'] = this.results.subscribe;

  public findNext(term: string): boolean {
    this.calls.push(`next:${term}`);
    return true;
  }

  public findPrevious(term: string): boolean {
    this.calls.push(`previous:${term}`);
    return true;
  }

  public clearDecorations(): void {
    this.cleared += 1;
  }
}

/**
 * A fake GPU renderer.
 */
class FakeWebgl {
  public disposed: number = 0;
  public failure: Error | undefined = undefined;
  public readonly contextLoss: FakeEvent<void> = new FakeEvent<void>();
  public readonly onContextLoss: FakeEvent<void>['subscribe'] = this.contextLoss.subscribe;

  public dispose(): void {
    this.disposed += 1;
    if (this.failure !== undefined) {
      throw this.failure;
    }
  }
}

/**
 * A fake resize observer, which reports only when told to.
 */
class FakeResizeObserver {
  public static readonly live: Set<FakeResizeObserver> = new Set<FakeResizeObserver>();

  public constructor(private readonly callback: () => void) {}

  public observe(): void {
    FakeResizeObserver.live.add(this);
  }

  public disconnect(): void {
    FakeResizeObserver.live.delete(this);
  }

  public report(): void {
    this.callback();
  }
}

/**
 * A call the fake bridge received.
 */
interface BridgeCall {
  readonly channel: string;
  readonly args: readonly unknown[];
}

/**
 * Answers a channel on the fake bridge.
 */
type BridgeHandler = (...args: readonly unknown[]) => unknown;

/**
 * A fake of the main process's end of the bridge: real IPC semantics (everything asynchronous),
 * programmable answers, and a record of what was asked.
 */
class FakeBridge implements Bridge {
  public readonly calls: BridgeCall[] = [];
  public readonly handlers: Map<string, BridgeHandler> = new Map<string, BridgeHandler>([
    [
      TerminalChannel.Replay,
      (): TerminalReplay => ({ data: '', seq: 0, exitCode: null, signal: null }),
    ],
    [TerminalChannel.Create, (): unknown => ({ success: true, pid: 1, shell: '/bin/zsh' })],
    [TerminalChannel.GetCwd, (): string => '/work'],
  ]);
  private readonly listeners: Map<string, Set<(...args: unknown[]) => void>> = new Map<
    string,
    Set<(...args: unknown[]) => void>
  >();

  public invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
    this.calls.push({ channel, args });
    const handler: BridgeHandler | undefined = this.handlers.get(channel);
    return Promise.resolve((handler === undefined ? true : handler(...args)) as T);
  }

  public send(): void {
    // Nothing the terminal sends is under test.
  }

  public on(channel: string, listener: (...args: unknown[]) => void): () => void {
    const set: Set<(...args: unknown[]) => void> =
      this.listeners.get(channel) ?? new Set<(...args: unknown[]) => void>();
    this.listeners.set(channel, set);
    set.add(listener);
    return (): void => {
      set.delete(listener);
    };
  }

  public emit(channel: string, ...args: unknown[]): void {
    for (const listener of [...(this.listeners.get(channel) ?? [])]) {
      listener(...args);
    }
  }

  public listenerCount(channel: string): number {
    return this.listeners.get(channel)?.size ?? 0;
  }

  public channelsCalled(): readonly string[] {
    return this.calls.map((call: BridgeCall): string => call.channel);
  }

  public callsTo(channel: string): readonly BridgeCall[] {
    return this.calls.filter((call: BridgeCall): boolean => call.channel === channel);
  }
}

/**
 * A promise settled from outside, standing in for an IPC reply still in flight.
 */
class Deferred<T> {
  public resolve: (value: T) => void = (): void => undefined;
  public reject: (reason: Error) => void = (): void => undefined;
  public readonly promise: Promise<T> = new Promise<T>(
    (resolve: (value: T) => void, reject: (reason: Error) => void): void => {
      this.resolve = resolve;
      this.reject = reject;
    },
  );
}

/**
 * A fake of the view's file opener: every path it is asked about exists.
 */
class FakePathLinks implements TerminalPathLinks {
  public readonly resolved: (string | null)[][] = [];
  public readonly opened: (string | number | null)[][] = [];

  public resolve(path: string, cwd: string | null): Promise<string | null> {
    this.resolved.push([path, cwd]);
    return Promise.resolve('/work/src/a.ts');
  }

  public open(path: string, line: number | null, column: number | null): Promise<void> {
    this.opened.push([path, line, column]);
    return Promise.resolve();
  }
}

/**
 * A link the pane handed xterm, as far as a test reaches into it.
 */
interface FoundLink {
  readonly text: string;
  activate(event: MouseEvent, text: string): void;
}

/**
 * What a test mounted, and what it recorded of the pane's outputs.
 */
interface Mounted {
  readonly fixture: ComponentFixture<Terminal>;
  readonly terminal: Terminal;
  readonly host: HTMLElement;
  readonly ready: number[];
  readonly exits: TerminalExit[];
  readonly titles: string[];
  readonly shells: string[];
  readonly finds: number[];
}

/**
 * The inputs a test may set.
 */
interface MountInputs {
  readonly kind?: 'shell' | 'run' | 'task';
  readonly cwd?: string;
  readonly shell?: string;
  readonly persistent?: boolean;
  readonly isActive?: boolean;
  readonly quietStart?: boolean;
  readonly width?: number;
  readonly height?: number;
}

describe('Terminal', () => {
  let bridge: FakeBridge;
  let xterms: FakeXterm[];
  let fits: FakeFit[];
  let searches: FakeSearch[];
  let webgls: FakeWebgl[];
  let webglFailure: Error | undefined;
  let writeText: ReturnType<typeof vi.fn>;
  let readText: ReturnType<typeof vi.fn>;

  /**
   * Lets the IPC replies and the promise chains they resume run out.
   */
  async function settle(): Promise<void> {
    for (let turn: number = 0; turn < 3; turn++) {
      await new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, 0);
      });
    }
    TestBed.tick();
  }

  /**
   * Gets the newest xterm.
   */
  function latest(): FakeXterm {
    const xterm: FakeXterm | undefined = xterms[xterms.length - 1];
    if (xterm === undefined) {
      throw new Error('No xterm was created');
    }
    return xterm;
  }

  /**
   * Creates the pane without letting it start.
   */
  function create(inputs: MountInputs = {}): Mounted {
    const fixture: ComponentFixture<Terminal> = TestBed.createComponent(Terminal);
    const ref: ComponentFixture<Terminal>['componentRef'] = fixture.componentRef;
    ref.setInput('terminalId', 'tab-1');
    for (const key of ['kind', 'cwd', 'shell', 'persistent', 'isActive', 'quietStart'] as const) {
      if (inputs[key] !== undefined) {
        ref.setInput(key, inputs[key]);
      }
    }
    const root: HTMLElement = fixture.nativeElement as HTMLElement;
    const host: HTMLElement | null = root.querySelector('.terminal');
    if (host === null) {
      throw new Error('The pane rendered no host');
    }
    Object.defineProperty(host, 'clientWidth', { value: inputs.width ?? 800, configurable: true });
    Object.defineProperty(host, 'clientHeight', {
      value: inputs.height ?? 480,
      configurable: true,
    });
    const mounted: Mounted = {
      fixture,
      terminal: fixture.componentInstance,
      host,
      ready: [],
      exits: [],
      titles: [],
      shells: [],
      finds: [],
    };
    mounted.terminal.ready.subscribe((): void => void mounted.ready.push(1));
    mounted.terminal.exited.subscribe((exit: TerminalExit): void => void mounted.exits.push(exit));
    mounted.terminal.titleChange.subscribe(
      (title: string): void => void mounted.titles.push(title),
    );
    mounted.terminal.shellChange.subscribe(
      (shell: string): void => void mounted.shells.push(shell),
    );
    mounted.terminal.findRequested.subscribe((): void => void mounted.finds.push(1));
    return mounted;
  }

  /**
   * Creates the pane and lets it start.
   */
  async function mount(inputs: MountInputs = {}): Promise<Mounted> {
    const mounted: Mounted = create(inputs);
    await mounted.fixture.whenStable();
    await settle();
    return mounted;
  }

  /**
   * Reads the labels of the open menu's rows.
   */
  function menuLabels(): readonly string[] {
    return Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).map(
      (row: HTMLElement): string => row.textContent.trim(),
    );
  }

  /**
   * Finds a row of the open menu.
   */
  function menuRow(label: string): HTMLElement {
    const found: HTMLElement | undefined = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((row: HTMLElement): boolean => row.textContent.trim() === label);
    if (found === undefined) {
      throw new Error(`No menu row '${label}'`);
    }
    return found;
  }

  /**
   * Installs the fake bridge and the fakes the pane's constructors reach.
   */
  function useElectron(): void {
    bridge = new FakeBridge();
    Object.defineProperty(window, 'bridge', { value: bridge, configurable: true });
  }

  /**
   * Sets the platform the pane reads its chords from.
   */
  function usePlatform(platform: string): void {
    Object.defineProperty(window, 'host', { value: { platform }, configurable: true });
  }

  beforeEach((): void => {
    xterms = [];
    fits = [];
    searches = [];
    webgls = [];
    webglFailure = undefined;
    hooks.xterm = (options: unknown): unknown => {
      const xterm: FakeXterm = new FakeXterm(options as Record<string, unknown>);
      xterms.push(xterm);
      return xterm;
    };
    hooks.fit = (): unknown => {
      const fit: FakeFit = new FakeFit();
      fits.push(fit);
      return fit;
    };
    hooks.search = (): unknown => {
      const search: FakeSearch = new FakeSearch();
      searches.push(search);
      return search;
    };
    hooks.webgl = (): unknown => {
      if (webglFailure !== undefined) {
        throw webglFailure;
      }
      const webgl: FakeWebgl = new FakeWebgl();
      webgls.push(webgl);
      return webgl;
    };
    writeText = vi.fn((): Promise<void> => Promise.resolve());
    readText = vi.fn((): Promise<string> => Promise.resolve(''));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText, readText },
      configurable: true,
    });
    FakeResizeObserver.live.clear();
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    TestBed.configureTestingModule({ imports: [Terminal] });
  });

  afterEach((): void => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(window, 'bridge');
    Reflect.deleteProperty(window, 'host');
    Reflect.deleteProperty(navigator, 'clipboard');
    localStorage.clear();
    document.querySelector('.cdk-overlay-container')?.replaceChildren();
  });

  describe('outside Electron', () => {
    it('render_whenOutsideElectron_showsTheUnavailableMessage', async () => {
      const mounted: Mounted = await mount();

      expect(mounted.host.textContent).toContain('only available');
      expect(xterms).toEqual([]);
    });

    it('restart_whenOutsideElectron_doesNothing', async () => {
      const mounted: Mounted = await mount();

      await mounted.terminal.restart();

      expect(xterms).toEqual([]);
    });

    it('imperatives_beforeAnyXterm_doNotThrow', async () => {
      const { terminal }: Mounted = await mount();

      terminal.focus();
      terminal.clear();
      terminal.copy();
      terminal.cut();
      terminal.scrollToBottom();
      terminal.handleResize();
      terminal.setScrollLocked(true);
      terminal.searchNext('a', {});
      terminal.searchPrevious('a', {});
      terminal.clearSearch();

      expect(terminal.bufferLines()).toEqual([]);
      expect(writeText).not.toHaveBeenCalled();
    });
  });

  describe('in Electron', () => {
    beforeEach((): void => {
      useElectron();
    });

    describe('starting', () => {
      it('start_shellPane_spawnsAtTheGridThenReportsReadyAndShell', async () => {
        const mounted: Mounted = await mount({ cwd: '/work' });

        const [call] = bridge.callsTo(TerminalChannel.Create);
        expect(call?.args[0]).toMatchObject({ id: 'tab-1', cols: 80, rows: 24, cwd: '/work' });
        expect(mounted.ready).toHaveLength(1);
        expect(mounted.shells).toEqual(['/bin/zsh']);
      });

      it('start_defaultShellSetting_isTrimmedAndUsed', async () => {
        TestBed.inject(Settings).set('terminal.defaultShell', '  /bin/fish  ');

        await mount();

        expect(bridge.callsTo(TerminalChannel.Create)[0]?.args[0]).toMatchObject({
          shell: '/bin/fish',
        });
      });

      it('start_blankDefaultShellSetting_leavesTheChoiceToMain', async () => {
        TestBed.inject(Settings).set('terminal.defaultShell', '   ');

        await mount();

        expect(bridge.callsTo(TerminalChannel.Create)[0]?.args[0]).toMatchObject({
          shell: undefined,
        });
      });

      it('start_shellInput_beatsTheDefaultShellSetting', async () => {
        TestBed.inject(Settings).set('terminal.defaultShell', '/bin/fish');

        await mount({ shell: '/bin/bash' });

        expect(bridge.callsTo(TerminalChannel.Create)[0]?.args[0]).toMatchObject({
          shell: '/bin/bash',
        });
      });

      it('start_resultWithoutShell_reportsNoShell', async () => {
        bridge.handlers.set(TerminalChannel.Create, (): unknown => ({ success: true, pid: 1 }));

        const mounted: Mounted = await mount();

        expect(mounted.shells).toEqual([]);
        expect(mounted.ready).toHaveLength(1);
      });

      it.each(['run', 'task'] as const)(
        'start_%sPane_attachesAndSizesThePtyWithoutSpawning',
        async (kind: 'run' | 'task') => {
          await mount({ kind });

          expect(bridge.callsTo(TerminalChannel.Create)).toEqual([]);
          expect(bridge.callsTo(TerminalChannel.Resize)[0]?.args).toEqual(['tab-1', 80, 24]);
        },
      );

      it('start_sessionEndedWhileDetached_showsItsHistoryAndBannerWithoutSpawning', async () => {
        bridge.handlers.set(TerminalChannel.Replay, (): TerminalReplay => ({
          data: 'history',
          seq: 7,
          exitCode: 3,
          signal: null,
        }));

        const mounted: Mounted = await mount();

        expect(bridge.callsTo(TerminalChannel.Create)).toEqual([]);
        expect(latest().written[0]).toBe('history');
        expect(latest().written[1]).toContain('Process exited with code 3');
        expect(mounted.terminal.isExited).toBe(true);
      });

      it('start_sessionKilledWhileDetached_namesTheSignalRatherThanCodeZero', async () => {
        bridge.handlers.set(TerminalChannel.Replay, (): TerminalReplay => ({
          data: '',
          seq: 0,
          exitCode: 0,
          signal: 15,
        }));

        await mount();

        expect(latest().written.join('')).toContain('terminated by signal 15');
        expect(latest().written.join('')).not.toContain('exited with code');
      });

      it('start_spawnRefused_printsTheReasonAndNeverGoesReady', async () => {
        bridge.handlers.set(TerminalChannel.Create, (): unknown => ({
          success: false,
          error: 'no such shell',
        }));

        const mounted: Mounted = await mount();

        expect(latest().written.join('')).toContain('Failed to start terminal: no such shell');
        expect(mounted.ready).toEqual([]);
        expect(TestBed.inject(Terminals).readText('tab-1')).toBeNull();
      });

      it('start_spawnRefusedWithoutReason_saysSo', async () => {
        bridge.handlers.set(TerminalChannel.Create, (): unknown => ({ success: false }));

        await mount();

        expect(latest().written.join('')).toContain('unknown error');
      });

      it('start_spawnRefused_stillShowsWhatTheSessionGoesOnToPrint', async () => {
        bridge.handlers.set(TerminalChannel.Create, (): unknown => ({ success: false }));
        await mount();

        bridge.emit(TerminalChannel.Data, 'tab-1', 'late', 1);

        expect(latest().written).toContain('late');
      });

      it('start_hostWithoutLayout_keepsTheDefaultGridUntilItHasOne', async () => {
        await mount({ width: 0, height: 0 });

        expect(fits[0]?.fits).toBe(0);
      });

      it('start_addressesTheXtermAtTheHostElement', async () => {
        const mounted: Mounted = await mount();

        expect(latest().opened).toBe(mounted.host);
      });
    });

    describe('reconciling a replay with live output', () => {
      it('replay_chunksTheSnapshotAlreadyHolds_areNotWrittenTwice', async () => {
        const reply: Deferred<TerminalReplay> = new Deferred<TerminalReplay>();
        bridge.handlers.set(TerminalChannel.Replay, (): Promise<TerminalReplay> => reply.promise);
        const mounted: Mounted = create();
        await mounted.fixture.whenStable();

        bridge.emit(TerminalChannel.Data, 'tab-1', 'three', 3);
        bridge.emit(TerminalChannel.Data, 'tab-1', 'four', 4);
        bridge.emit(TerminalChannel.Data, 'tab-1', 'five', 5);
        reply.resolve({ data: 'through-four', seq: 4, exitCode: null, signal: null });
        await settle();

        expect(latest().written).toEqual(['through-four', 'five']);
      });

      it('replay_chunksArrivingDuringTheSpawn_landInOrderAfterTheSnapshot', async () => {
        const spawned: Deferred<unknown> = new Deferred<unknown>();
        bridge.handlers.set(TerminalChannel.Create, (): Promise<unknown> => spawned.promise);
        const mounted: Mounted = create();
        await mounted.fixture.whenStable();
        await settle();

        bridge.emit(TerminalChannel.Data, 'tab-1', 'first', 1);
        bridge.emit(TerminalChannel.Data, 'tab-1', 'second', 2);
        expect(latest().written).toEqual([]);
        spawned.resolve({ success: true, pid: 1 });
        await settle();

        expect(latest().written).toEqual(['first', 'second']);
      });

      it('replay_emptySnapshot_writesNothingOfItsOwn', async () => {
        await mount();

        expect(latest().written).toEqual([]);
      });
    });

    describe('input and output', () => {
      it('output_ownSession_isWritten', async () => {
        await mount();

        bridge.emit(TerminalChannel.Data, 'tab-1', 'hello', 1);

        expect(latest().written).toEqual(['hello']);
      });

      it('output_anotherSession_isIgnored', async () => {
        await mount();

        bridge.emit(TerminalChannel.Data, 'tab-2', 'not mine', 1);

        expect(latest().written).toEqual([]);
      });

      it('input_keystroke_reachesThePty', async () => {
        await mount();

        latest().data.fire('ls');

        expect(bridge.callsTo(TerminalChannel.Write)[0]?.args).toEqual(['tab-1', 'ls']);
      });

      it('input_taskPane_forwardsOnlyTheInterrupt', async () => {
        await mount({ kind: 'task' });

        latest().data.fire('ls');
        latest().data.fire('\x03');

        expect(bridge.callsTo(TerminalChannel.Write).map((call: BridgeCall) => call.args)).toEqual([
          ['tab-1', '\x03'],
        ]);
      });

      it('title_shellChangesIt_isReported', async () => {
        const mounted: Mounted = await mount();

        latest().title.fire('vim');

        expect(mounted.titles).toEqual(['vim']);
      });

      it('runCommand_writesTheLineAndReturnsFocus', async () => {
        const { terminal }: Mounted = await mount();
        const before: number = latest().focusCount;

        terminal.runCommand('npm test');

        expect(bridge.callsTo(TerminalChannel.Write)[0]?.args).toEqual(['tab-1', 'npm test\r']);
        expect(latest().focusCount).toBe(before + 1);
      });

      it('agentHandle_readsTheBufferWithoutTrailingBlankLines', async () => {
        await mount();
        latest().active.rowsOfText = [new FakeRow('one'), new FakeRow('two'), new FakeRow('')];

        expect(TestBed.inject(Terminals).readText('tab-1')).toBe('one\ntwo');
      });
    });

    describe('exiting', () => {
      it('exit_ownSession_bannerAndOutput', async () => {
        const mounted: Mounted = await mount();

        bridge.emit(TerminalChannel.Exit, 'tab-1', 2, null);

        expect(latest().written.join('')).toContain('Process exited with code 2');
        expect(mounted.exits).toEqual([{ code: 2, signal: null }]);
        expect(mounted.terminal.isExited).toBe(true);
      });

      it('exit_bySignal_doesNotReadAsSuccess', async () => {
        const mounted: Mounted = await mount();

        bridge.emit(TerminalChannel.Exit, 'tab-1', 0, 9);

        expect(latest().written.join('')).toContain('terminated by signal 9');
        expect(mounted.exits).toEqual([{ code: 0, signal: 9 }]);
      });

      it('exit_anotherSession_isIgnored', async () => {
        const mounted: Mounted = await mount();

        bridge.emit(TerminalChannel.Exit, 'tab-2', 0, null);

        expect(mounted.exits).toEqual([]);
        expect(mounted.terminal.isExited).toBe(false);
      });
    });

    describe('restarting', () => {
      it('restart_disposesTheDyingSessionBeforeSpawningItsReplacement', async () => {
        const { terminal }: Mounted = await mount();
        bridge.calls.length = 0;

        await terminal.restart();

        const channels: readonly string[] = bridge.channelsCalled();
        expect(channels.indexOf(TerminalChannel.Dispose)).toBeGreaterThanOrEqual(0);
        expect(channels.indexOf(TerminalChannel.Dispose)).toBeLessThan(
          channels.indexOf(TerminalChannel.Create),
        );
      });

      it('restart_replacesTheXtermAndKeepsTheIdentifier', async () => {
        const { terminal }: Mounted = await mount();
        const first: FakeXterm = latest();

        await terminal.restart();

        expect(first.disposed).toBe(true);
        expect(latest()).not.toBe(first);
        expect(bridge.callsTo(TerminalChannel.Create)[1]?.args[0]).toMatchObject({ id: 'tab-1' });
      });

      it('restart_reusesTheShellActuallySpawned_notALaterDefault', async () => {
        const { terminal }: Mounted = await mount();
        TestBed.inject(Settings).set('terminal.defaultShell', '/bin/fish');

        await terminal.restart();

        expect(bridge.callsTo(TerminalChannel.Create)[1]?.args[0]).toMatchObject({
          shell: '/bin/zsh',
        });
      });

      it('newSession_withAShell_spawnsThatShell', async () => {
        const { terminal }: Mounted = await mount();

        await terminal.newSession('/bin/bash');

        expect(bridge.callsTo(TerminalChannel.Create)[1]?.args[0]).toMatchObject({
          shell: '/bin/bash',
        });
      });

      it('newSession_withoutAShell_fallsBackToTheConfiguredDefault', async () => {
        const { terminal }: Mounted = await mount();
        TestBed.inject(Settings).set('terminal.defaultShell', '/bin/fish');

        await terminal.newSession();

        expect(bridge.callsTo(TerminalChannel.Create)[1]?.args[0]).toMatchObject({
          shell: '/bin/fish',
        });
      });

      it('restart_afterExit_isLiveAgain', async () => {
        const { terminal }: Mounted = await mount();
        bridge.emit(TerminalChannel.Exit, 'tab-1', 1, null);

        await terminal.restart();

        expect(terminal.isExited).toBe(false);
      });

      it('restart_outputReachesOnlyTheNewXtermAndOnlyOnce', async () => {
        const { terminal }: Mounted = await mount();
        const first: FakeXterm = latest();

        await terminal.restart();
        bridge.emit(TerminalChannel.Data, 'tab-1', 'fresh', 1);

        expect(first.written).toEqual([]);
        expect(latest().written).toEqual(['fresh']);
      });

      it('restart_leavesOneExitListenerAndOneResizeObserver', async () => {
        const { terminal }: Mounted = await mount();

        await terminal.restart();
        await terminal.restart();

        expect(bridge.listenerCount(TerminalChannel.Exit)).toBe(1);
        expect(FakeResizeObserver.live.size).toBe(1);
      });

      it('restart_exitReportsOnce', async () => {
        const mounted: Mounted = await mount();

        await mounted.terminal.restart();
        bridge.emit(TerminalChannel.Exit, 'tab-1', 0, null);

        expect(mounted.exits).toHaveLength(1);
      });

      it('restart_ofAQuietPane_takesFocusAsUsual', async () => {
        const { terminal, fixture }: Mounted = await mount({ quietStart: true, isActive: true });

        await terminal.restart();
        await fixture.whenStable();
        await settle();

        expect(latest().focusCount).toBeGreaterThan(0);
      });
    });

    describe('tearing down', () => {
      it('destroy_ownedSession_disposesItAndUnregistersTheHandle', async () => {
        const { fixture }: Mounted = await mount();
        const xterm: FakeXterm = latest();

        fixture.destroy();

        expect(bridge.callsTo(TerminalChannel.Dispose)[0]?.args).toEqual(['tab-1']);
        expect(xterm.disposed).toBe(true);
        expect(TestBed.inject(Terminals).readText('tab-1')).toBeNull();
      });

      it('destroy_persistentSession_leavesItRunning', async () => {
        const { fixture }: Mounted = await mount({ persistent: true });

        fixture.destroy();

        expect(bridge.callsTo(TerminalChannel.Dispose)).toEqual([]);
        expect(latest().disposed).toBe(true);
      });

      it('destroy_thenReattach_replaysWhatWasMissed', async () => {
        const first: Mounted = await mount({ persistent: true });
        first.fixture.destroy();
        bridge.handlers.set(TerminalChannel.Replay, (): TerminalReplay => ({
          data: 'while away',
          seq: 9,
          exitCode: null,
          signal: null,
        }));

        await mount({ persistent: true });

        expect(latest().written).toEqual(['while away']);
      });

      it('destroy_removesEveryListenerItAdded', async () => {
        const { fixture }: Mounted = await mount();
        expect(bridge.listenerCount(TerminalChannel.Exit)).toBe(1);

        fixture.destroy();

        expect(bridge.listenerCount(TerminalChannel.Exit)).toBe(0);
        expect(FakeResizeObserver.live.size).toBe(0);
      });

      it('destroy_lateOutputAndExit_areDropped', async () => {
        const mounted: Mounted = await mount();
        const xterm: FakeXterm = latest();
        mounted.fixture.destroy();

        bridge.emit(TerminalChannel.Data, 'tab-1', 'late', 1);
        bridge.emit(TerminalChannel.Exit, 'tab-1', 0, null);

        expect(xterm.written).toEqual([]);
        expect(mounted.exits).toEqual([]);
      });

      it('destroy_pasteOnTheOldHost_isNotCaught', async () => {
        const { fixture, host }: Mounted = await mount();
        fixture.destroy();

        const paste: Event = new Event('paste', { cancelable: true });
        host.dispatchEvent(paste);

        expect(paste.defaultPrevented).toBe(false);
        expect(TestBed.inject(TerminalConfirmation).pending()).toBeNull();
      });

      it('destroy_openResizeWindow_doesNotFireAfterwards', async () => {
        const { fixture, terminal }: Mounted = await mount();
        vi.useFakeTimers();
        terminal.handleResize();
        terminal.handleResize();
        bridge.calls.length = 0;

        fixture.destroy();
        await vi.advanceTimersByTimeAsync(500);

        expect(bridge.callsTo(TerminalChannel.Resize)).toEqual([]);
      });

      it('destroy_midBellFlash_cancelsTheFlash', async () => {
        TestBed.inject(Settings).set('terminal.bell', 'visual');
        const { fixture, host }: Mounted = await mount();
        vi.useFakeTimers();
        latest().bell.fire();
        expect(host.classList.contains('terminal--bell')).toBe(true);

        fixture.destroy();
        await vi.advanceTimersByTimeAsync(500);

        expect(host.classList.contains('terminal--bell')).toBe(true);
      });

      it('destroy_ofAPaneThatFailedToStart_stillDisposesTheSession', async () => {
        bridge.handlers.set(TerminalChannel.Create, (): unknown => ({ success: false }));
        const { fixture }: Mounted = await mount();

        fixture.destroy();

        expect(bridge.callsTo(TerminalChannel.Dispose)).toHaveLength(1);
      });

      it('destroy_outsideElectron_doesNotThrow', async () => {
        Reflect.deleteProperty(window, 'bridge');
        const { fixture }: Mounted = await mount();

        expect((): void => fixture.destroy()).not.toThrow();
      });
    });

    describe('mid-flight', () => {
      it('destroy_duringTheReplay_spawnsNothing', async () => {
        const reply: Deferred<TerminalReplay> = new Deferred<TerminalReplay>();
        bridge.handlers.set(TerminalChannel.Replay, (): Promise<TerminalReplay> => reply.promise);
        const mounted: Mounted = create();
        await mounted.fixture.whenStable();

        mounted.fixture.destroy();
        reply.resolve({ data: 'history', seq: 1, exitCode: null, signal: null });
        await new Promise<void>((resolve: () => void): void => {
          setTimeout(resolve, 0);
        });

        expect(bridge.callsTo(TerminalChannel.Create)).toEqual([]);
        expect(latest().written).toEqual([]);
        expect(mounted.ready).toEqual([]);
      });

      it('destroy_duringTheSpawn_leavesNothingBehind', async () => {
        const spawned: Deferred<unknown> = new Deferred<unknown>();
        bridge.handlers.set(TerminalChannel.Create, (): Promise<unknown> => spawned.promise);
        const mounted: Mounted = create();
        await mounted.fixture.whenStable();
        await new Promise<void>((resolve: () => void): void => {
          setTimeout(resolve, 0);
        });

        mounted.fixture.destroy();
        spawned.resolve({ success: true, pid: 1, shell: '/bin/zsh' });
        await new Promise<void>((resolve: () => void): void => {
          setTimeout(resolve, 0);
        });

        expect(TestBed.inject(Terminals).readText('tab-1')).toBeNull();
        expect(FakeResizeObserver.live.size).toBe(0);
        expect(mounted.ready).toEqual([]);
        expect(mounted.shells).toEqual([]);
      });

      it('destroy_duringARefusedSpawn_writesNothingToTheDisposedXterm', async () => {
        const spawned: Deferred<unknown> = new Deferred<unknown>();
        bridge.handlers.set(TerminalChannel.Create, (): Promise<unknown> => spawned.promise);
        const mounted: Mounted = create();
        await mounted.fixture.whenStable();
        await new Promise<void>((resolve: () => void): void => {
          setTimeout(resolve, 0);
        });

        mounted.fixture.destroy();
        spawned.resolve({ success: false, error: 'late' });
        await new Promise<void>((resolve: () => void): void => {
          setTimeout(resolve, 0);
        });

        expect(latest().written).toEqual([]);
      });

      it('destroy_duringARestart_startsNoNewTerminal', async () => {
        const { terminal, fixture }: Mounted = await mount();
        const disposed: Deferred<boolean> = new Deferred<boolean>();
        bridge.handlers.set(TerminalChannel.Dispose, (): Promise<boolean> => disposed.promise);
        bridge.calls.length = 0;

        const restarted: Promise<void> = terminal.restart();
        fixture.destroy();
        disposed.resolve(true);
        await restarted;

        expect(xterms).toHaveLength(1);
        expect(bridge.callsTo(TerminalChannel.Create)).toEqual([]);
      });

      it('destroy_justAfterGoingLive_doesNotFocusTheDisposedXterm', async () => {
        const mounted: Mounted = create();
        mounted.terminal.ready.subscribe((): void => {
          mounted.fixture.destroy();
        });
        await mounted.fixture.whenStable();
        await settle();
        const focused: number = latest().focusCount;

        await settle();

        expect(latest().focusCount).toBe(focused);
        expect(latest().disposed).toBe(true);
        expect(focused).toBe(0);
      });

      it('destroy_beforeTheFirstRender_doesNotThrow', () => {
        const { fixture }: Mounted = create();

        expect((): void => fixture.destroy()).not.toThrow();
      });

      it('restart_twiceAtOnce_leavesOneLiveTerminal', async () => {
        const { terminal }: Mounted = await mount();

        await Promise.all([terminal.restart(), terminal.restart()]);
        await settle();
        bridge.emit(TerminalChannel.Data, 'tab-1', 'once', 1);

        const live: readonly FakeXterm[] = xterms.filter((xterm: FakeXterm) => !xterm.disposed);
        expect(live).toHaveLength(1);
        expect(live[0]?.written).toEqual(['once']);
        expect(bridge.listenerCount(TerminalChannel.Exit)).toBe(1);
        expect(FakeResizeObserver.live.size).toBe(1);
      });

      it('restart_whileStillStarting_leavesOneLiveTerminal', async () => {
        const reply: Deferred<TerminalReplay> = new Deferred<TerminalReplay>();
        bridge.handlers.set(TerminalChannel.Replay, (): Promise<TerminalReplay> => reply.promise);
        const mounted: Mounted = create();
        await mounted.fixture.whenStable();

        const restarted: Promise<void> = mounted.terminal.restart();
        reply.resolve({ data: '', seq: 0, exitCode: null, signal: null });
        await restarted;
        await settle();

        expect(xterms.filter((xterm: FakeXterm) => !xterm.disposed)).toHaveLength(1);
        expect(mounted.ready).toHaveLength(1);
        expect(FakeResizeObserver.live.size).toBe(1);
      });

      it('start_replayRefused_saysSoAndKeepsShowingOutput', async () => {
        bridge.handlers.set(TerminalChannel.Replay, (): Promise<never> =>
          Promise.reject(new Error('no handler for terminal:replay')),
        );

        const mounted: Mounted = await mount();
        bridge.emit(TerminalChannel.Data, 'tab-1', 'still here', 1);

        expect(latest().written.join('')).toContain(
          'Failed to start terminal: no handler for terminal:replay',
        );
        expect(latest().written).toContain('still here');
        expect(mounted.ready).toEqual([]);
      });

      it('start_spawnRejected_saysSoAndKeepsShowingOutput', async () => {
        bridge.handlers.set(TerminalChannel.Create, (): Promise<never> =>
          Promise.reject(new Error('ipc closed')),
        );

        const mounted: Mounted = await mount();
        bridge.emit(TerminalChannel.Data, 'tab-1', 'still here', 1);

        expect(latest().written.join('')).toContain('Failed to start terminal: ipc closed');
        expect(latest().written).toContain('still here');
        expect(mounted.ready).toEqual([]);
      });

      it('destroy_thenReplayRejected_staysQuiet', async () => {
        const reply: Deferred<TerminalReplay> = new Deferred<TerminalReplay>();
        bridge.handlers.set(TerminalChannel.Replay, (): Promise<TerminalReplay> => reply.promise);
        const mounted: Mounted = create();
        await mounted.fixture.whenStable();

        mounted.fixture.destroy();
        reply.reject(new Error('window closing'));
        await new Promise<void>((resolve: () => void): void => {
          setTimeout(resolve, 0);
        });

        expect(latest().written).toEqual([]);
      });

      it('exit_duringTheReplay_landsAfterTheHistoryAndOnlyOnce', async () => {
        const reply: Deferred<TerminalReplay> = new Deferred<TerminalReplay>();
        bridge.handlers.set(TerminalChannel.Replay, (): Promise<TerminalReplay> => reply.promise);
        const mounted: Mounted = create();
        await mounted.fixture.whenStable();

        bridge.emit(TerminalChannel.Exit, 'tab-1', 4, null);
        reply.resolve({ data: 'history', seq: 2, exitCode: 4, signal: null });
        await settle();

        const banners: readonly string[] = latest().written.filter((chunk: string) =>
          chunk.includes('Process exited'),
        );
        expect(banners).toHaveLength(1);
        expect(latest().written[0]).toBe('history');
        expect(mounted.exits).toEqual([{ code: 4, signal: null }]);
      });

      it('exit_duringTheSpawn_landsAfterTheOutputItEnded', async () => {
        const spawned: Deferred<unknown> = new Deferred<unknown>();
        bridge.handlers.set(TerminalChannel.Create, (): Promise<unknown> => spawned.promise);
        const mounted: Mounted = create();
        await mounted.fixture.whenStable();
        await settle();

        bridge.emit(TerminalChannel.Data, 'tab-1', 'last words', 1);
        bridge.emit(TerminalChannel.Exit, 'tab-1', 1, null);
        spawned.resolve({ success: true, pid: 1 });
        await settle();

        expect(latest().written[0]).toBe('last words');
        expect(latest().written[1]).toContain('Process exited with code 1');
      });
    });

    describe('resizing', () => {
      it('resize_plausibleHost_fitsAndShipsTheGrid', async () => {
        const { terminal }: Mounted = await mount();
        const before: number = fits[0]?.fits ?? 0;
        vi.useFakeTimers();

        terminal.handleResize();

        expect(fits[0]?.fits).toBe(before + 1);
        expect(bridge.callsTo(TerminalChannel.Resize).at(-1)?.args).toEqual(['tab-1', 80, 24]);
      });

      it.each([
        [39, 480],
        [800, 19],
        [0, 0],
      ])(
        'resize_degenerateHost_%ix%i_neverReachesThePty',
        async (width: number, height: number) => {
          const { terminal }: Mounted = await mount({ width, height });
          vi.useFakeTimers();

          terminal.handleResize();

          expect(fits[0]?.fits).toBe(0);
          expect(bridge.callsTo(TerminalChannel.Resize)).toEqual([]);
        },
      );

      it.each([
        [40, 20],
        [41, 21],
      ])('resize_smallestRealHost_%ix%i_fits', async (width: number, height: number) => {
        const { terminal }: Mounted = await mount({ width, height });
        vi.useFakeTimers();

        terminal.handleResize();

        expect(bridge.callsTo(TerminalChannel.Resize)).toHaveLength(1);
      });

      it('resize_detachedHost_neverReachesThePty', async () => {
        const { terminal, host }: Mounted = await mount();
        vi.useFakeTimers();
        host.remove();

        terminal.handleResize();

        expect(bridge.callsTo(TerminalChannel.Resize)).toEqual([]);
      });

      it('resize_fitThrows_isTreatedAsNoLayout', async () => {
        const { terminal }: Mounted = await mount();
        vi.useFakeTimers();
        const fit: FakeFit | undefined = fits[0];
        if (fit !== undefined) {
          fit.failure = new Error('edge geometry');
        }

        expect((): void => terminal.handleResize()).not.toThrow();

        expect(bridge.callsTo(TerminalChannel.Resize)).toEqual([]);
      });

      it('resize_aBurst_costsOneLeadingAndOneTrailingFit', async () => {
        const { terminal }: Mounted = await mount();
        vi.useFakeTimers();

        for (let frame: number = 0; frame < 30; frame++) {
          terminal.handleResize();
        }
        expect(bridge.callsTo(TerminalChannel.Resize)).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(100);

        expect(bridge.callsTo(TerminalChannel.Resize)).toHaveLength(2);
      });

      it('resize_aLoneCall_hasNoTrailingFit', async () => {
        const { terminal }: Mounted = await mount();
        vi.useFakeTimers();

        terminal.handleResize();
        await vi.advanceTimersByTimeAsync(1000);

        expect(bridge.callsTo(TerminalChannel.Resize)).toHaveLength(1);
      });

      it('resize_observerReports_fits', async () => {
        await mount();
        vi.useFakeTimers();

        for (const observer of FakeResizeObserver.live) {
          observer.report();
        }

        expect(bridge.callsTo(TerminalChannel.Resize)).toHaveLength(1);
      });
    });

    describe('focus', () => {
      it('focus_activePane_takesItOnStart', async () => {
        await mount({ isActive: true });

        expect(latest().focusCount).toBeGreaterThan(0);
      });

      it('focus_quietStart_doesNotTakeItWhileWatched', async () => {
        await mount({ quietStart: true, isActive: true });

        expect(latest().focusCount).toBe(0);
      });

      it('focus_quietStart_takesItOnceTheUserComesBack', async () => {
        const { fixture }: Mounted = await mount({ quietStart: true, isActive: true });

        fixture.componentRef.setInput('isActive', false);
        await fixture.whenStable();
        fixture.componentRef.setInput('isActive', true);
        await fixture.whenStable();

        expect(latest().focusCount).toBeGreaterThan(0);
      });

      it('focus_quietStartMountedHidden_firstShowIsStillQuiet', async () => {
        const { fixture }: Mounted = await mount({ quietStart: true, isActive: false });

        fixture.componentRef.setInput('isActive', true);
        await fixture.whenStable();

        expect(latest().focusCount).toBe(0);
      });
    });

    describe('scroll lock', () => {
      it('scrollLock_engaged_holdsTheViewportAgainstOutput', async () => {
        const { terminal }: Mounted = await mount();
        terminal.setScrollLocked(true);
        latest().active.viewportY = 42;

        bridge.emit(TerminalChannel.Data, 'tab-1', 'more', 1);

        expect(latest().written).toEqual(['more']);
        expect(latest().scrolledTo).toEqual([42]);
        expect(latest().options['scrollOnUserInput']).toBe(false);
      });

      it('scrollLock_released_followsTheOutputAgain', async () => {
        const { terminal }: Mounted = await mount();
        terminal.setScrollLocked(true);
        terminal.setScrollLocked(false);

        bridge.emit(TerminalChannel.Data, 'tab-1', 'more', 1);

        expect(latest().scrolledTo).toEqual([]);
        expect(latest().options['scrollOnUserInput']).toBe(true);
      });
    });

    describe('find', () => {
      it.each([
        ['darwin', { key: 'f', metaKey: true }, true],
        ['darwin', { key: 'F', metaKey: true }, true],
        ['darwin', { key: 'f', ctrlKey: true }, false],
        ['darwin', { key: 'f', metaKey: true, shiftKey: true }, false],
        ['linux', { key: 'F', ctrlKey: true, shiftKey: true }, true],
        ['linux', { key: 'f', ctrlKey: true }, false],
        ['win32', { key: 'f', metaKey: true }, false],
        ['linux', { key: 'g', ctrlKey: true, shiftKey: true }, false],
      ])(
        'find_%s_%j_requested_%s',
        async (platform: string, init: KeyboardEventInit, requested: boolean) => {
          usePlatform(platform);
          const mounted: Mounted = await mount();

          const forwarded: boolean | undefined = latest().keyHandler?.(
            new KeyboardEvent('keydown', init),
          );

          expect(mounted.finds).toHaveLength(requested ? 1 : 0);
          expect(forwarded).toBe(!requested);
        },
      );

      it('find_keyUp_isForwarded', async () => {
        usePlatform('darwin');
        const mounted: Mounted = await mount();

        const forwarded: boolean | undefined = latest().keyHandler?.(
          new KeyboardEvent('keyup', { key: 'f', metaKey: true }),
        );

        expect(forwarded).toBe(true);
        expect(mounted.finds).toEqual([]);
      });

      it('search_drivesTheAddonAndClears', async () => {
        const { terminal }: Mounted = await mount();

        terminal.searchNext('needle', {});
        terminal.searchPrevious('needle', {});
        terminal.clearSearch();

        expect(searches[0]?.calls).toEqual(['next:needle', 'previous:needle']);
        expect(searches[0]?.cleared).toBe(1);
      });

      it('searchResults_reachTheListener', async () => {
        const { terminal }: Mounted = await mount();
        const seen: number[][] = [];
        terminal.onSearchResults((active: number, count: number): void => {
          seen.push([active, count]);
        });

        searches[0]?.results.fire({ resultIndex: 2, resultCount: 5 });

        expect(seen).toEqual([[2, 5]]);
      });

      it('searchResults_aReplacedListenersRemover_leavesTheNewOneInPlace', async () => {
        const { terminal }: Mounted = await mount();
        const seen: string[] = [];
        const removeOld: () => void = terminal.onSearchResults((): void => {
          seen.push('old');
        });
        const removeNew: () => void = terminal.onSearchResults((): void => {
          seen.push('new');
        });

        removeOld();
        searches[0]?.results.fire({ resultIndex: 0, resultCount: 1 });
        removeNew();
        searches[0]?.results.fire({ resultIndex: 0, resultCount: 1 });

        expect(seen).toEqual(['new']);
      });

      it('bufferLines_rejoinsSoftWrappedRows', async () => {
        const { terminal }: Mounted = await mount();
        latest().active.rowsOfText = [
          new FakeRow('long '),
          new FakeRow('line', true),
          new FakeRow('short'),
        ];

        expect(terminal.bufferLines()).toEqual(['long line', 'short']);
      });

      it('bufferLines_aFirstRowMarkedWrapped_isStillALine', async () => {
        const { terminal }: Mounted = await mount();
        latest().active.rowsOfText = [new FakeRow('scrolled off', true)];

        expect(terminal.bufferLines()).toEqual(['scrolled off']);
      });
    });

    describe('clipboard', () => {
      it('copy_withASelection_copiesIt', async () => {
        const { terminal }: Mounted = await mount();
        latest().selection = 'picked';

        terminal.copy();

        expect(writeText).toHaveBeenCalledWith('picked');
      });

      it('copy_withoutASelection_copiesTheBuffer', async () => {
        const { terminal }: Mounted = await mount();
        latest().active.rowsOfText = [new FakeRow('a'), new FakeRow('b')];

        terminal.copy();

        expect(writeText).toHaveBeenCalledWith('a\nb');
      });

      it('copy_ofNothing_leavesTheClipboardAlone', async () => {
        const { terminal }: Mounted = await mount();

        terminal.copy();

        expect(writeText).not.toHaveBeenCalled();
      });

      it('cut_copiesTheBufferThenClears', async () => {
        const { terminal }: Mounted = await mount();
        latest().active.rowsOfText = [new FakeRow('gone')];

        terminal.cut();

        expect(writeText).toHaveBeenCalledWith('gone');
        expect(latest().clearCount).toBe(1);
      });

      it('copyOnSelect_on_copiesASelection', async () => {
        TestBed.inject(Settings).set('terminal.copyOnSelect', true);
        await mount();
        latest().selection = 'picked';

        latest().selectionChange.fire();

        expect(writeText).toHaveBeenCalledWith('picked');
      });

      it('copyOnSelect_selectionCleared_leavesTheClipboardAlone', async () => {
        TestBed.inject(Settings).set('terminal.copyOnSelect', true);
        await mount();

        latest().selectionChange.fire();

        expect(writeText).not.toHaveBeenCalled();
      });

      it('copyOnSelect_off_leavesTheClipboardAlone', async () => {
        TestBed.inject(Settings).set('terminal.copyOnSelect', false);
        await mount();
        latest().selection = 'picked';

        latest().selectionChange.fire();

        expect(writeText).not.toHaveBeenCalled();
      });
    });

    describe('pasting', () => {
      /**
       * Answers the open paste question.
       */
      async function answer(confirmed: boolean): Promise<void> {
        TestBed.inject(TerminalConfirmation).answer(confirmed);
        await settle();
      }

      beforeEach((): void => {
        TestBed.inject(Settings).set('terminal.warnMultiLinePaste', true);
      });

      it('paste_oneLine_goesStraightIn', async () => {
        const { terminal }: Mounted = await mount();
        readText.mockResolvedValue('ls');

        terminal.paste();
        await settle();

        expect(latest().pasted).toEqual(['ls']);
        expect(TestBed.inject(TerminalConfirmation).pending()).toBeNull();
      });

      it('paste_emptyClipboard_doesNothing', async () => {
        const { terminal }: Mounted = await mount();

        terminal.paste();
        await settle();

        expect(latest().pasted).toEqual([]);
      });

      it('paste_severalLines_waitsForTheUser', async () => {
        const { terminal }: Mounted = await mount();
        readText.mockResolvedValue('rm -rf a\nrm -rf b');

        terminal.paste();
        await settle();

        expect(TestBed.inject(TerminalConfirmation).pending()?.title).toBe('Paste 2 Lines?');
        expect(latest().pasted).toEqual([]);
      });

      it('paste_confirmed_goesIn', async () => {
        const { terminal }: Mounted = await mount();
        readText.mockResolvedValue('a\nb');
        terminal.paste();
        await settle();

        await answer(true);

        expect(latest().pasted).toEqual(['a\nb']);
      });

      it('paste_declined_neverReachesTheShell', async () => {
        const { terminal }: Mounted = await mount();
        readText.mockResolvedValue('a\nb');
        terminal.paste();
        await settle();

        await answer(false);

        expect(latest().pasted).toEqual([]);
      });

      it('paste_warningOff_goesStraightIn', async () => {
        TestBed.inject(Settings).set('terminal.warnMultiLinePaste', false);
        const { terminal }: Mounted = await mount();
        readText.mockResolvedValue('a\nb');

        terminal.paste();
        await settle();

        expect(latest().pasted).toEqual(['a\nb']);
      });

      it('paste_restartWhileTheQuestionIsOpen_goesToTheTerminalThereNow', async () => {
        const { terminal }: Mounted = await mount();
        const first: FakeXterm = latest();
        readText.mockResolvedValue('a\nb');
        terminal.paste();
        await settle();

        await terminal.restart();
        await answer(true);

        expect(first.pasted).toEqual([]);
        expect(latest().pasted).toEqual(['a\nb']);
      });

      it('paste_destroyedWhileTheQuestionIsOpen_goesNowhere', async () => {
        const { terminal, fixture }: Mounted = await mount();
        const xterm: FakeXterm = latest();
        readText.mockResolvedValue('a\nb');
        terminal.paste();
        await settle();

        fixture.destroy();
        await answer(true);

        expect(xterm.pasted).toEqual([]);
      });

      /**
       * Fires a paste event carrying the text at the pane.
       */
      function pasteEvent(host: HTMLElement, text: string): Event {
        const event: Event = new Event('paste', { cancelable: true, bubbles: true });
        Object.defineProperty(event, 'clipboardData', {
          value: { getData: (): string => text },
        });
        host.dispatchEvent(event);
        return event;
      }

      it('pasteEvent_oneLine_isLeftToXterm', async () => {
        const { host }: Mounted = await mount();

        const event: Event = pasteEvent(host, 'ls');

        expect(event.defaultPrevented).toBe(false);
      });

      it('pasteEvent_severalLines_isHeldForTheQuestion', async () => {
        const { host }: Mounted = await mount();

        const event: Event = pasteEvent(host, 'a\nb');
        await settle();

        expect(event.defaultPrevented).toBe(true);
        expect(latest().pasted).toEqual([]);
        expect(TestBed.inject(TerminalConfirmation).pending()).not.toBeNull();
      });

      it('pasteEvent_oneListenerAfterARestart_asksOnce', async () => {
        const { host, terminal }: Mounted = await mount();
        const ask: ReturnType<typeof vi.spyOn> = vi.spyOn(
          TestBed.inject(TerminalConfirmation),
          'ask',
        );
        await terminal.restart();

        pasteEvent(host, 'a\nb');

        expect(ask).toHaveBeenCalledTimes(1);
      });
    });

    describe('links', () => {
      let pathLinks: FakePathLinks;

      /**
       * Reads the link handler the pane gave xterm for hyperlinks a program marked up.
       */
      function osc8(): {
        activate(event: MouseEvent, url: string): void;
        hover(event: MouseEvent, url: string): void;
        leave(): void;
      } {
        return latest().options['linkHandler'] as ReturnType<typeof osc8>;
      }

      beforeEach((): void => {
        pathLinks = new FakePathLinks();
        usePlatform('darwin');
      });

      /**
       * Reads the external addresses the pane asked the main process to open.
       */
      function openedExternally(): readonly unknown[] {
        return bridge.calls
          .filter((call: BridgeCall): boolean => call.channel === String(ShellChannel.OpenExternal))
          .map((call: BridgeCall): unknown => call.args[0]);
      }

      it('link_modifierClick_opensInTheBrowser', async () => {
        await mount();

        osc8().activate(new MouseEvent('click', { metaKey: true }), 'https://example.com');

        expect(openedExternally()).toEqual(['https://example.com']);
      });

      it('link_plainClick_opensNothing_soSelectingStillWorks', async () => {
        await mount();

        osc8().activate(new MouseEvent('click'), 'https://example.com');

        expect(openedExternally()).toEqual([]);
      });

      it('link_middleClickWithModifier_opensNothing', async () => {
        await mount();

        osc8().activate(new MouseEvent('click', { metaKey: true, button: 1 }), 'https://x.test');

        expect(openedExternally()).toEqual([]);
      });

      it('link_ctrlOnAMac_opensNothing', async () => {
        await mount();

        osc8().activate(new MouseEvent('click', { ctrlKey: true }), 'https://x.test');

        expect(openedExternally()).toEqual([]);
      });

      it('link_ctrlElsewhere_opens', async () => {
        usePlatform('linux');
        await mount();

        osc8().activate(new MouseEvent('click', { ctrlKey: true }), 'https://x.test');

        expect(openedExternally()).toEqual(['https://x.test']);
      });

      it('link_settingClick_opensOnAPlainClick', async () => {
        TestBed.inject(Settings).set('terminal.linkOpening', 'click');
        await mount();

        osc8().activate(new MouseEvent('click'), 'https://x.test');

        expect(openedExternally()).toEqual(['https://x.test']);
      });

      it('link_settingOff_opensNothing', async () => {
        TestBed.inject(Settings).set('terminal.linkOpening', 'off');
        await mount();

        osc8().activate(new MouseEvent('click', { metaKey: true }), 'https://x.test');

        expect(openedExternally()).toEqual([]);
      });

      it('link_settingOff_findsNoLinksInTheOutput', async () => {
        TestBed.inject(Settings).set('terminal.linkOpening', 'off');
        await mount();
        latest().active.rowsOfText = [new FakeRow('see https://example.com now')];
        const provided: (unknown[] | undefined)[] = [];

        latest().linkProvider?.provideLinks(1, (links: unknown[] | undefined): void => {
          provided.push(links);
        });

        expect(provided).toEqual([undefined]);
      });

      it('link_addressInTheOutput_isFound', async () => {
        await mount();
        latest().active.rowsOfText = [new FakeRow('see https://example.com now')];

        const links: unknown[] | undefined = await new Promise<unknown[] | undefined>(
          (resolve: (links: unknown[] | undefined) => void): void => {
            latest().linkProvider?.provideLinks(1, resolve);
          },
        );

        expect(links).toHaveLength(1);
      });

      it('link_pathInTheOutput_resolvesAgainstTheShellsCurrentDirectory', async () => {
        TestBed.configureTestingModule({
          providers: [{ provide: TERMINAL_PATH_LINKS, useValue: pathLinks }],
        });
        await mount({ cwd: '/started' });
        latest().active.rowsOfText = [new FakeRow('at src/a.ts:3:1')];

        await new Promise<unknown>((resolve: (links: unknown) => void): void => {
          latest().linkProvider?.provideLinks(1, resolve);
        });

        expect(pathLinks.resolved).toEqual([['src/a.ts', '/work']]);
      });

      it('link_cwdLookupFails_fallsBackToWhereTheShellStarted', async () => {
        TestBed.configureTestingModule({
          providers: [{ provide: TERMINAL_PATH_LINKS, useValue: pathLinks }],
        });
        bridge.handlers.set(TerminalChannel.GetCwd, (): Promise<string> =>
          Promise.reject(new Error('gone')),
        );
        await mount({ cwd: '/started' });
        latest().active.rowsOfText = [new FakeRow('at src/a.ts')];

        await new Promise<unknown>((resolve: (links: unknown) => void): void => {
          latest().linkProvider?.provideLinks(1, resolve);
        });

        expect(pathLinks.resolved).toEqual([['src/a.ts', '/started']]);
      });

      it('link_pathModifierClick_opensTheFileAtItsLine', async () => {
        TestBed.configureTestingModule({
          providers: [{ provide: TERMINAL_PATH_LINKS, useValue: pathLinks }],
        });
        await mount();
        latest().active.rowsOfText = [new FakeRow('at src/a.ts:3:7')];

        const links: FoundLink[] = await new Promise<FoundLink[]>(
          (resolve: (links: FoundLink[]) => void): void => {
            latest().linkProvider?.provideLinks(1, (found: unknown[] | undefined): void => {
              resolve((found ?? []) as FoundLink[]);
            });
          },
        );
        links[0]?.activate(new MouseEvent('click', { metaKey: true }), links[0].text);

        expect(pathLinks.opened).toEqual([['/work/src/a.ts', 3, 7]]);
      });

      it('link_aRunOfHovers_readsTheCwdOnce', async () => {
        TestBed.configureTestingModule({
          providers: [{ provide: TERMINAL_PATH_LINKS, useValue: pathLinks }],
        });
        await mount();
        latest().active.rowsOfText = [new FakeRow('at src/a.ts')];

        for (let hover: number = 0; hover < 3; hover++) {
          await new Promise<unknown>((resolve: (links: unknown) => void): void => {
            latest().linkProvider?.provideLinks(1, resolve);
          });
        }

        expect(bridge.callsTo(TerminalChannel.GetCwd)).toHaveLength(1);
      });

      it('hover_withLinksOff_opensNoHint', async () => {
        TestBed.inject(Settings).set('terminal.linkOpening', 'off');
        TestBed.inject(Settings).set('accessibility.tooltipDelay', 0);
        await mount();

        osc8().hover(new MouseEvent('mousemove'), 'https://x.test');
        await settle();

        expect(document.body.textContent).not.toContain('to open');
      });

      it('hover_namesTheLinkAndItsGesture', async () => {
        TestBed.inject(Settings).set('accessibility.tooltipDelay', 0);
        await mount();

        osc8().hover(new MouseEvent('mousemove'), 'https://x.test');
        await settle();

        expect(document.body.textContent).toContain('https://x.test (⌘-click to open)');
      });

      it('rightClick_onAnAddress_offersOpenAndCopy', async () => {
        const { host }: Mounted = await mount();
        osc8().hover(new MouseEvent('mousemove'), 'https://x.test');

        host.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        await settle();

        expect(menuLabels()).toEqual(['Open Link', 'Copy Link Address']);
      });

      it('rightClick_copyAddress_copiesIt', async () => {
        const { host }: Mounted = await mount();
        osc8().hover(new MouseEvent('mousemove'), 'https://x.test');
        host.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        await settle();

        menuRow('Copy Link Address').click();
        await settle();

        expect(writeText).toHaveBeenCalledWith('https://x.test');
      });

      it('rightClick_openAddress_opensItWhateverTheLinkSetting', async () => {
        const { host }: Mounted = await mount();
        osc8().hover(new MouseEvent('mousemove'), 'https://x.test');
        host.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        await settle();

        menuRow('Open Link').click();
        await settle();

        expect(openedExternally()).toEqual(['https://x.test']);
      });

      it('rightClick_afterTheLinkScrolledAway_isTheTerminalsMenu', async () => {
        const { host }: Mounted = await mount();
        osc8().hover(new MouseEvent('mousemove'), 'https://x.test');
        latest().scroll.fire(1);

        host.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        await settle();

        expect(menuLabels()).toEqual(['Copy', 'Paste', 'Clear', 'Find']);
      });

      it('hover_scrollAndLeave_doNotThrow', async () => {
        await mount();

        osc8().hover(new MouseEvent('mousemove'), 'https://x.test');
        latest().scroll.fire(1);
        osc8().leave();

        expect(latest().disposed).toBe(false);
      });
    });

    describe('right-click', () => {
      /**
       * Right-clicks the pane.
       */
      function rightClick(host: HTMLElement): MouseEvent {
        const event: MouseEvent = new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: 5,
          clientY: 5,
        });
        host.dispatchEvent(event);
        return event;
      }

      it('rightClick_settingPaste_pastes', async () => {
        TestBed.inject(Settings).set('terminal.rightClick', 'paste');
        const { host }: Mounted = await mount();
        readText.mockResolvedValue('ls');

        const event: MouseEvent = rightClick(host);
        await settle();

        expect(event.defaultPrevented).toBe(true);
        expect(latest().pasted).toEqual(['ls']);
      });

      it('rightClick_settingSelectWord_isLeftToXterm', async () => {
        TestBed.inject(Settings).set('terminal.rightClick', 'select-word');
        const { host }: Mounted = await mount();

        const event: MouseEvent = rightClick(host);
        await settle();

        expect(event.defaultPrevented).toBe(false);
        expect(latest().options['rightClickSelectsWord']).toBe(true);
      });

      it('rightClick_menu_offersTheTerminalsActions', async () => {
        TestBed.inject(Settings).set('terminal.rightClick', 'menu');
        const { host }: Mounted = await mount();

        rightClick(host);
        await settle();

        expect(menuLabels()).toEqual(['Copy', 'Paste', 'Clear', 'Find']);
      });

      it('rightClick_withoutASelection_disablesCopy', async () => {
        TestBed.inject(Settings).set('terminal.rightClick', 'menu');
        const { host }: Mounted = await mount();

        rightClick(host);
        await settle();

        expect(menuRow('Copy').getAttribute('aria-disabled')).toBe('true');
      });

      it('rightClick_taskPane_disablesPaste', async () => {
        TestBed.inject(Settings).set('terminal.rightClick', 'menu');
        const { host }: Mounted = await mount({ kind: 'task' });

        rightClick(host);
        await settle();

        expect(menuRow('Paste').getAttribute('aria-disabled')).toBe('true');
      });

      it('rightClick_copy_copiesTheSelection', async () => {
        TestBed.inject(Settings).set('terminal.rightClick', 'menu');
        const { host }: Mounted = await mount();
        latest().selection = 'picked';
        rightClick(host);
        await settle();

        menuRow('Copy').click();
        await settle();

        expect(writeText).toHaveBeenCalledWith('picked');
      });

      it('rightClick_paste_pastes', async () => {
        TestBed.inject(Settings).set('terminal.rightClick', 'menu');
        const { host }: Mounted = await mount();
        readText.mockResolvedValue('ls');
        rightClick(host);
        await settle();

        menuRow('Paste').click();
        await settle();

        expect(latest().pasted).toEqual(['ls']);
      });

      it('rightClick_clear_clears', async () => {
        TestBed.inject(Settings).set('terminal.rightClick', 'menu');
        const { host }: Mounted = await mount();
        rightClick(host);
        await settle();

        menuRow('Clear').click();
        await settle();

        expect(latest().clearCount).toBe(1);
      });

      it('rightClick_find_asksForTheFindPanel', async () => {
        TestBed.inject(Settings).set('terminal.rightClick', 'menu');
        const mounted: Mounted = await mount();
        rightClick(mounted.host);
        await settle();

        menuRow('Find').click();
        await settle();

        expect(mounted.finds).toHaveLength(1);
      });

      it('rightClick_beforeTheTerminalExists_doesNothing', async () => {
        Reflect.deleteProperty(window, 'bridge');
        TestBed.inject(Settings).set('terminal.rightClick', 'paste');
        const { host }: Mounted = await mount();

        const event: MouseEvent = rightClick(host);

        expect(event.defaultPrevented).toBe(false);
      });
    });

    describe('rendering', () => {
      it('renderer_gpu_drawsWithWebgl', async () => {
        TestBed.inject(Settings).set('terminal.renderer', 'gpu');

        await mount();

        expect(webgls).toHaveLength(1);
        expect(latest().addons).toContain(webgls[0]);
      });

      it('renderer_webglUnavailable_leavesTheStandardRendererDrawing', async () => {
        TestBed.inject(Settings).set('terminal.renderer', 'gpu');
        webglFailure = new Error('no WebGL2');

        const mounted: Mounted = await mount();

        expect(webgls).toEqual([]);
        expect(mounted.ready).toHaveLength(1);
      });

      it('renderer_contextLost_fallsBackAndSurvivesTheNextFrame', async () => {
        TestBed.inject(Settings).set('terminal.renderer', 'gpu');
        await mount();

        webgls[0]?.contextLoss.fire();

        expect(webgls[0]?.disposed).toBe(1);
        expect(latest().disposed).toBe(false);
      });

      it('renderer_lostContextFailsToTearDown_isSwallowed', async () => {
        TestBed.inject(Settings).set('terminal.renderer', 'gpu');
        await mount();
        const webgl: FakeWebgl | undefined = webgls[0];
        if (webgl !== undefined) {
          webgl.failure = new Error('already lost');
        }

        expect((): void => webgl?.contextLoss.fire()).not.toThrow();
      });

      it('renderer_switchedToStandard_stopsDrawingOnTheGpu', async () => {
        TestBed.inject(Settings).set('terminal.renderer', 'gpu');
        const { fixture }: Mounted = await mount();

        TestBed.inject(Settings).set('terminal.renderer', 'standard');
        await fixture.whenStable();

        expect(webgls[0]?.disposed).toBe(1);
      });

      it('renderer_restart_loadsAFreshWebglOntoTheNewTerminal', async () => {
        TestBed.inject(Settings).set('terminal.renderer', 'gpu');
        const { terminal }: Mounted = await mount();

        await terminal.restart();

        expect(webgls).toHaveLength(2);
        expect(webgls[0]?.disposed).toBe(1);
        expect(latest().addons).toContain(webgls[1]);
      });

      it('renderer_destroy_releasesWebgl', async () => {
        TestBed.inject(Settings).set('terminal.renderer', 'gpu');
        const { fixture }: Mounted = await mount();

        fixture.destroy();

        expect(webgls[0]?.disposed).toBe(1);
      });
    });

    describe('appearance', () => {
      it('appearance_fontChange_reachesTheRunningTerminalAndRefits', async () => {
        const { fixture }: Mounted = await mount();
        const before: number = fits[0]?.fits ?? 0;

        TestBed.inject(Settings).set('terminal.fontSize', 23);
        await fixture.whenStable();

        expect(latest().options['fontSize']).toBeDefined();
        expect(fits[0]?.fits).toBeGreaterThan(before);
      });

      it('appearance_cursorChange_doesNotRefit', async () => {
        const { fixture }: Mounted = await mount();
        await settle();
        const before: number = fits[0]?.fits ?? 0;

        TestBed.inject(Settings).set('terminal.cursorBlink', true);
        await fixture.whenStable();

        expect(latest().options['cursorBlink']).toBe(true);
        expect(fits[0]?.fits).toBe(before);
      });

      it('theme_change_reachesTheRunningTerminal', async () => {
        const { fixture }: Mounted = await mount();
        const before: unknown = latest().options['theme'];
        const theme: Theme = TestBed.inject(Theme);

        theme.setMode(theme.resolvedMode() === 'dark' ? 'light' : 'dark');
        await fixture.whenStable();

        expect(latest().options['theme']).not.toEqual(before);
      });
    });

    describe('the bell', () => {
      it('bell_visual_flashesAndEnds', async () => {
        TestBed.inject(Settings).set('terminal.bell', 'visual');
        const { host }: Mounted = await mount();
        vi.useFakeTimers();

        latest().bell.fire();
        expect(host.classList.contains('terminal--bell')).toBe(true);
        await vi.advanceTimersByTimeAsync(150);

        expect(host.classList.contains('terminal--bell')).toBe(false);
      });

      it('bell_visualTwice_extendsTheFlash', async () => {
        TestBed.inject(Settings).set('terminal.bell', 'visual');
        const { host }: Mounted = await mount();
        vi.useFakeTimers();

        latest().bell.fire();
        await vi.advanceTimersByTimeAsync(100);
        latest().bell.fire();
        await vi.advanceTimersByTimeAsync(100);

        expect(host.classList.contains('terminal--bell')).toBe(true);
      });

      it('bell_sound_ringsWithoutFlashing', async () => {
        const started: ReturnType<typeof vi.fn> = vi.fn();
        const node: () => unknown = (): unknown => ({
          connect: (next: unknown): unknown => next,
          frequency: { value: 0 },
          gain: {
            setValueAtTime: (): void => undefined,
            exponentialRampToValueAtTime: (): void => undefined,
          },
          start: started,
          stop: (): void => undefined,
        });
        vi.stubGlobal(
          'AudioContext',
          class {
            public readonly currentTime: number = 0;
            public readonly destination: unknown = {};
            public readonly createOscillator: () => unknown = node;
            public readonly createGain: () => unknown = node;
          },
        );
        TestBed.inject(Settings).set('terminal.bell', 'sound');
        const { host }: Mounted = await mount();

        latest().bell.fire();

        expect(started).toHaveBeenCalledTimes(1);
        expect(host.classList.contains('terminal--bell')).toBe(false);
      });

      it('bell_none_doesNotFlash', async () => {
        TestBed.inject(Settings).set('terminal.bell', 'none');
        const { host }: Mounted = await mount();

        latest().bell.fire();

        expect(host.classList.contains('terminal--bell')).toBe(false);
      });
    });
  });
});
