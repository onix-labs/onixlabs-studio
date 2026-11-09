import {
  computed,
  effect,
  inject,
  OnDestroy,
  Service,
  signal,
  Signal,
  untracked,
  WritableSignal,
} from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import type {
  TestAdapterCapability,
  TestAdapterErrorCode,
  TestNode,
  TestResult,
  TestRunResults,
} from '@shared/api/test-adapter-protocol';
import {
  TestAdapterInfo,
  TestChannel,
  TestDebugPlanAnswer,
  TestDiscoverAnswer,
  TestResultsAnswer,
  TestRunPlan,
  TestRunPlanAnswer,
} from '@shared/api/test-channels';
import { Log } from '@shared/angular/services/log/log';
import { Workspace } from '@shared/angular/services/workspace/workspace';
import {
  DISPOSED_EXIT_CODE,
  TerminalLaunch,
  TerminalSession,
  TerminalSessions,
} from '@shared/angular/services/terminal-sessions/terminal-sessions';
import { TerminalBridge } from '@shared/angular/services/terminal-bridge/terminal-bridge';
import {
  TestAtLocation,
  TestRunHandler,
  TestRunMode,
  TestRuns,
} from '@shared/angular/services/tests/test-runs';
import { DebugSession } from '@features/workspace/angular/debug/debug-session';
import {
  entryAt,
  indexTree,
  mergeFound,
  nodeOfResult,
  TestEntry,
  testKey,
  TestState,
} from './test-tree';

/**
 * Says what the explorer is doing.
 */
export type TestExplorerPhase = 'idle' | 'discovering' | 'running' | 'debugging';

/**
 * Describes why an adapter has no tree to show.
 */
export interface TestAdapterProblem {
  /**
   * Gets the reason, in the user's terms.
   */
  readonly message: string;

  /**
   * Gets what kind of failure it is, when that changes what the panel says.
   */
  readonly code?: TestAdapterErrorCode;
}

/**
 * Holds the Tests panel's state for one workspace tab (#1352): which adapters apply to its folder, the
 * tree each found, how each test last came out, and the run in progress. Provided per directory view,
 * so it outlives the panel — a tool tab that is not showing is destroyed — and a run carries on while
 * the panel is hidden.
 *
 * ⛔ Core UI only: everything here comes from the test-adapter slot (#1351). It knows no framework; it
 * asks the host for a plan, runs the plan's command in the workspace's Tests terminal, and hands the
 * terminal's transcript back for the adapter to read.
 */
@Service()
export class TestExplorer implements OnDestroy {
  /**
   * Holds this tab's workspace, whose folder the tests are found in.
   */
  private readonly workspace: Workspace = inject(Workspace);

  /**
   * Holds the workspace's terminal sessions, where runs are shown.
   */
  private readonly sessions: TerminalSessions = inject(TerminalSessions);

  /**
   * Holds the terminal transport, for a finished run's transcript.
   */
  private readonly terminalBridge: TerminalBridge = inject(TerminalBridge);

  /**
   * Holds the workspace's debugger.
   */
  private readonly debugSession: DebugSession = inject(DebugSession);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the generic transport, or undefined outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Holds the terminal session every run of this tab reuses, so the Terminal panel shows one Tests tab.
   */
  private readonly sessionId: string = `tests-${crypto.randomUUID()}`;

  /**
   * Holds the adapters that apply to the folder, installed or not.
   */
  private readonly adaptersSignal: WritableSignal<readonly TestAdapterInfo[]> = signal<
    readonly TestAdapterInfo[]
  >([]);

  /**
   * Holds each installed adapter's discovered tree, by plugin.
   */
  private readonly discovered: WritableSignal<ReadonlyMap<string, readonly TestNode[]>> = signal<
    ReadonlyMap<string, readonly TestNode[]>
  >(new Map<string, readonly TestNode[]>());

  /**
   * Holds the tests only a run found, by plugin and then by parent identifier.
   */
  private readonly found: WritableSignal<
    ReadonlyMap<string, ReadonlyMap<string, readonly TestNode[]>>
  > = signal<ReadonlyMap<string, ReadonlyMap<string, readonly TestNode[]>>>(
    new Map<string, ReadonlyMap<string, readonly TestNode[]>>(),
  );

  /**
   * Holds why an adapter has no tree, by plugin.
   */
  private readonly problemsSignal: WritableSignal<ReadonlyMap<string, TestAdapterProblem>> = signal<
    ReadonlyMap<string, TestAdapterProblem>
  >(new Map<string, TestAdapterProblem>());

  /**
   * Holds each test's last state, by key.
   */
  private readonly statesSignal: WritableSignal<ReadonlyMap<string, TestState>> = signal<
    ReadonlyMap<string, TestState>
  >(new Map<string, TestState>());

  /**
   * Holds the tests running now.
   */
  private readonly runningSignal: WritableSignal<ReadonlySet<string>> = signal<ReadonlySet<string>>(
    new Set<string>(),
  );

  /**
   * Holds the tests waiting their turn in the run.
   */
  private readonly queuedSignal: WritableSignal<ReadonlySet<string>> = signal<ReadonlySet<string>>(
    new Set<string>(),
  );

  /**
   * Holds what the explorer is doing.
   */
  private readonly phaseSignal: WritableSignal<TestExplorerPhase> =
    signal<TestExplorerPhase>('idle');

  /**
   * Holds why the last run as a whole failed, when it did — a build that broke, a tool that is missing.
   */
  private readonly runProblemSignal: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds the generation of the current discovery, so a stale one (the folder changed) is dropped.
   */
  private generation: number = 0;

  /**
   * Holds whether the user stopped the run, so the adapters still queued do not start.
   */
  private stopped: boolean = false;

  /**
   * Holds the debug launch awaiting its session's end, to be finished then.
   */
  private debugRunId: string | null = null;

  /**
   * Holds the function that unregisters this tab from the run/debug-a-test seam.
   */
  private readonly unregister: () => void;

  /**
   * Gets the adapters that apply to the folder, installed or not.
   */
  public readonly adapters: Signal<readonly TestAdapterInfo[]> = this.adaptersSignal.asReadonly();

  /**
   * Gets the installed adapters that apply to the folder.
   */
  public readonly installed: Signal<readonly TestAdapterInfo[]> = computed(
    (): readonly TestAdapterInfo[] =>
      this.adaptersSignal().filter((adapter: TestAdapterInfo): boolean => adapter.installed),
  );

  /**
   * Gets why each adapter has no tree, by plugin.
   */
  public readonly problems: Signal<ReadonlyMap<string, TestAdapterProblem>> =
    this.problemsSignal.asReadonly();

  /**
   * Gets each test's last state.
   */
  public readonly states: Signal<ReadonlyMap<string, TestState>> = this.statesSignal.asReadonly();

  /**
   * Gets the tests running now.
   */
  public readonly running: Signal<ReadonlySet<string>> = this.runningSignal.asReadonly();

  /**
   * Gets the tests waiting to run.
   */
  public readonly queued: Signal<ReadonlySet<string>> = this.queuedSignal.asReadonly();

  /**
   * Gets what the explorer is doing.
   */
  public readonly phase: Signal<TestExplorerPhase> = this.phaseSignal.asReadonly();

  /**
   * Gets why the last run as a whole failed, or null.
   */
  public readonly runProblem: Signal<string | null> = this.runProblemSignal.asReadonly();

  /**
   * Gets the merged tree of every installed adapter, by key, in tree order.
   */
  public readonly index: Signal<ReadonlyMap<string, TestEntry>> = computed(
    (): ReadonlyMap<string, TestEntry> => {
      const index: Map<string, TestEntry> = new Map<string, TestEntry>();
      const found: ReadonlyMap<string, ReadonlyMap<string, readonly TestNode[]>> = this.found();
      for (const [pluginId, roots] of this.discovered()) {
        indexTree(
          pluginId,
          mergeFound(roots, found.get(pluginId) ?? new Map<string, readonly TestNode[]>()),
          index,
        );
      }
      return index;
    },
  );

  /**
   * Gets whether any test failed or errored in its last run.
   */
  public readonly hasFailures: Signal<boolean> = computed((): boolean =>
    [...this.statesSignal().values()].some(
      (state: TestState): boolean => state.outcome === 'failed' || state.outcome === 'errored',
    ),
  );

  /**
   * Initializes the explorer: it reads the folder's tests whenever the open folder changes, and
   * registers with the run/debug-a-test seam for as long as the tab is open.
   */
  public constructor() {
    effect((): void => {
      const root: string | null = this.workspace.root()?.path ?? null;
      untracked((): void => {
        void this.refresh(root);
      });
    });
    // A debug launch's output folder is kept until its session ends, since the launch may read it.
    effect((): void => {
      const idle: boolean = this.debugSession.state() === 'idle';
      untracked((): void => {
        if (idle && this.debugRunId !== null) {
          void this.bridge?.invoke(TestChannel.Finish, this.debugRunId);
          this.debugRunId = null;
          if (this.phaseSignal() === 'debugging') {
            this.phaseSignal.set('idle');
          }
        }
      });
    });
    const handler: TestRunHandler = {
      root: (): string | null => this.workspace.root()?.path ?? null,
      testAt: (path: string, line: number): TestAtLocation | null => this.testAt(path, line),
      run: (test: TestAtLocation, mode: TestRunMode): Promise<boolean> =>
        mode === 'debug'
          ? this.debug(testKey(test.pluginId, test.id))
          : this.run([testKey(test.pluginId, test.id)]),
    };
    this.unregister = inject(TestRuns).register(handler);
  }

  /**
   * Unregisters from the run/debug-a-test seam when the tab closes.
   */
  public ngOnDestroy(): void {
    this.unregister();
  }

  /**
   * Gets whether an adapter confirmed a capability in its manifest.
   * @param pluginId The adapter.
   * @param capability The capability.
   * @returns Returns true when it declares it.
   */
  public can(pluginId: string, capability: TestAdapterCapability): boolean {
    return (
      this.adaptersSignal()
        .find((adapter: TestAdapterInfo): boolean => adapter.pluginId === pluginId)
        ?.capabilities.includes(capability) === true
    );
  }

  /**
   * Finds the test a source line declares.
   * @param path The file's absolute path.
   * @param line The 1-based line.
   * @returns Returns the test, or null when the line declares none.
   */
  public testAt(path: string, line: number): TestAtLocation | null {
    const entry: TestEntry | undefined = entryAt(this.index(), path, line);
    if (entry === undefined) {
      return null;
    }
    return {
      pluginId: entry.pluginId,
      id: entry.node.id,
      label: entry.node.label,
      kind: entry.node.kind,
      debuggable: entry.node.kind === 'test' && this.can(entry.pluginId, 'debug'),
    };
  }

  /**
   * Reads the folder's tests again: which adapters apply, then each installed one's tree. Results are
   * kept for tests that are still there.
   * @param root The folder, or the open one when omitted.
   */
  public async refresh(root: string | null = this.workspace.root()?.path ?? null): Promise<void> {
    const generation: number = ++this.generation;
    if (root === null || this.bridge === undefined) {
      this.adaptersSignal.set([]);
      this.discovered.set(new Map<string, readonly TestNode[]>());
      this.problemsSignal.set(new Map<string, TestAdapterProblem>());
      return;
    }
    if (this.phaseSignal() === 'idle') {
      this.phaseSignal.set('discovering');
    }
    try {
      const adapters: readonly TestAdapterInfo[] = await this.bridge.invoke<
        readonly TestAdapterInfo[]
      >(TestChannel.Adapters, root);
      if (generation !== this.generation) {
        return;
      }
      this.adaptersSignal.set(adapters);
      const trees: Map<string, readonly TestNode[]> = new Map<string, readonly TestNode[]>();
      const problems: Map<string, TestAdapterProblem> = new Map<string, TestAdapterProblem>();
      for (const adapter of adapters.filter((candidate: TestAdapterInfo) => candidate.installed)) {
        const answer: TestDiscoverAnswer = await this.bridge.invoke<TestDiscoverAnswer>(
          TestChannel.Discover,
          adapter.pluginId,
          root,
        );
        if (generation !== this.generation) {
          return;
        }
        if (answer.ok) {
          trees.set(adapter.pluginId, answer.value.tests);
        } else {
          problems.set(adapter.pluginId, {
            message: answer.error,
            ...(answer.code === undefined ? {} : { code: answer.code }),
          });
        }
      }
      this.discovered.set(trees);
      this.problemsSignal.set(problems);
      this.log.info(
        'workspace.tests',
        `Found tests through ${trees.size} adapter(s)`,
        [...trees.keys()].join(', '),
      );
    } catch (error: unknown) {
      this.log.error('workspace.tests', 'Could not read the tests', error);
    } finally {
      if (generation === this.generation && this.phaseSignal() === 'discovering') {
        this.phaseSignal.set('idle');
      }
    }
  }

  /**
   * Runs every test of every installed adapter.
   * @returns Returns a promise resolving true once the run started.
   */
  public runAll(): Promise<boolean> {
    return this.runPlugins(
      this.installed().map((adapter: TestAdapterInfo) => ({ pluginId: adapter.pluginId, ids: [] })),
    );
  }

  /**
   * Runs the tests that failed or errored last time.
   * @returns Returns a promise resolving true once the run started.
   */
  public runFailed(): Promise<boolean> {
    const failed: string[] = [];
    for (const [key, state] of this.statesSignal()) {
      if ((state.outcome === 'failed' || state.outcome === 'errored') && this.index().has(key)) {
        failed.push(key);
      }
    }
    return failed.length === 0 ? Promise.resolve(false) : this.run(failed);
  }

  /**
   * Runs nodes — a test, or a suite, file or project standing for the tests beneath it.
   * @param keys The nodes' keys.
   * @returns Returns a promise resolving true once the run started.
   */
  public run(keys: readonly string[]): Promise<boolean> {
    const byPlugin: Map<string, string[]> = new Map<string, string[]>();
    for (const key of keys) {
      const entry: TestEntry | undefined = this.index().get(key);
      if (entry === undefined) {
        continue;
      }
      const ids: string[] = byPlugin.get(entry.pluginId) ?? [];
      ids.push(entry.node.id);
      byPlugin.set(entry.pluginId, ids);
    }
    return this.runPlugins(
      [...byPlugin].map(([pluginId, ids]: [string, string[]]) => ({ pluginId, ids })),
    );
  }

  /**
   * Debugs one test.
   * @param key The test's key.
   * @returns Returns a promise resolving true once the debug session started.
   */
  public async debug(key: string): Promise<boolean> {
    const entry: TestEntry | undefined = this.index().get(key);
    const root: string | null = this.workspace.root()?.path ?? null;
    if (
      entry?.node.kind !== 'test' ||
      root === null ||
      this.bridge === undefined ||
      this.phaseSignal() === 'running' ||
      this.debugSession.state() !== 'idle'
    ) {
      return false;
    }
    const answer: TestDebugPlanAnswer = await this.bridge.invoke<TestDebugPlanAnswer>(
      TestChannel.PlanDebug,
      entry.pluginId,
      root,
      entry.node.id,
    );
    if (!answer.ok) {
      this.runProblemSignal.set(answer.error);
      return false;
    }
    this.runProblemSignal.set(null);
    this.log.info('workspace.tests', 'Debug a test', entry.node.label);
    const started: boolean = await this.debugSession.launchTest(answer.value.launch);
    if (!started) {
      void this.bridge.invoke(TestChannel.Finish, answer.value.runId);
      return false;
    }
    this.debugRunId = answer.value.runId;
    this.phaseSignal.set('debugging');
    return true;
  }

  /**
   * Stops the run: the command in the Tests terminal is interrupted, and adapters still waiting do not
   * start. What the interrupted command reported is still read.
   */
  public stop(): void {
    if (this.phaseSignal() !== 'running') {
      return;
    }
    this.log.info('workspace.tests', 'Stop the test run');
    this.stopped = true;
    this.queuedSignal.set(new Set<string>());
    this.sessions.terminate(this.sessionId);
  }

  /**
   * Brings the Tests terminal forward.
   */
  public showOutput(): void {
    this.sessions.activateAndReveal(this.sessionId);
  }

  /**
   * Gets whether a run has used the Tests terminal, so there is output to show.
   * @returns Returns true when there is.
   */
  public hasOutput(): boolean {
    return this.sessions
      .sessions()
      .some((session: TerminalSession): boolean => session.id === this.sessionId);
  }

  /**
   * Runs each adapter's share of a run in turn, in the one Tests terminal.
   * @param requests What to run, per adapter; empty identifiers run all of an adapter's tests.
   * @returns Returns a promise resolving true once the run started.
   */
  private runPlugins(
    requests: readonly { readonly pluginId: string; readonly ids: readonly string[] }[],
  ): Promise<boolean> {
    const root: string | null = this.workspace.root()?.path ?? null;
    if (
      requests.length === 0 ||
      root === null ||
      this.bridge === undefined ||
      this.phaseSignal() === 'running' ||
      this.phaseSignal() === 'debugging'
    ) {
      return Promise.resolve(false);
    }
    this.stopped = false;
    this.runProblemSignal.set(null);
    this.phaseSignal.set('running');
    const queued: Set<string> = new Set<string>();
    for (const request of requests) {
      for (const key of this.testsOf(request.pluginId, request.ids)) {
        queued.add(key);
      }
    }
    this.queuedSignal.set(queued);
    void this.runQueue(root, requests);
    return Promise.resolve(true);
  }

  /**
   * Works through a run's adapters in turn.
   * @param root The folder.
   * @param requests What to run, per adapter.
   */
  private async runQueue(
    root: string,
    requests: readonly { readonly pluginId: string; readonly ids: readonly string[] }[],
  ): Promise<void> {
    try {
      for (const request of requests) {
        if (this.stopped) {
          break;
        }
        await this.runOne(root, request.pluginId, request.ids);
      }
    } catch (error: unknown) {
      this.log.error('workspace.tests', 'The test run failed', error);
      this.runProblemSignal.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.runningSignal.set(new Set<string>());
      this.queuedSignal.set(new Set<string>());
      this.phaseSignal.set('idle');
    }
  }

  /**
   * Runs one adapter's share: plan, run its command in the Tests terminal, then read its results.
   * @param root The folder.
   * @param pluginId The adapter.
   * @param ids The nodes asked for, or empty for all.
   */
  private async runOne(root: string, pluginId: string, ids: readonly string[]): Promise<void> {
    const bridge: Bridge = this.bridge!;
    const answer: TestRunPlanAnswer = await bridge.invoke<TestRunPlanAnswer>(
      TestChannel.PlanRun,
      pluginId,
      root,
      ids,
    );
    if (!answer.ok) {
      this.runProblemSignal.set(answer.error);
      return;
    }
    const plan: TestRunPlan = answer.value;
    // A plugin that cannot narrow a run runs everything it found.
    const tests: readonly string[] = this.testsOf(pluginId, plan.selected ? ids : []);
    this.moveToRunning(tests);
    this.log.info('workspace.tests', `Run tests: ${plan.command.title}`, plan.command.executable);
    const launch: TerminalLaunch = await this.sessions.launch({
      sessionId: this.sessionId,
      name: 'Tests',
      kind: 'task',
      command: plan.command.executable,
      args: plan.command.args,
      cwd: plan.command.cwd,
      ...(plan.command.env === undefined ? {} : { env: plan.command.env }),
      // ⛔ The Tests panel stays in front: the run shows in the Terminal panel's Tests tab, a click
      // away, and the panel's own progress is what the user is watching.
      reveal: false,
    });
    const exitCode: number = await launch.exited;
    const transcript: string =
      exitCode === DISPOSED_EXIT_CODE
        ? ''
        : (await this.terminalBridge.replay(this.sessionId)).data;
    const results: TestResultsAnswer = await bridge.invoke<TestResultsAnswer>(
      TestChannel.Results,
      plan.runId,
      exitCode,
      transcript,
    );
    if (!results.ok) {
      this.runProblemSignal.set(results.error);
      this.clearRunning(tests);
      return;
    }
    this.apply(pluginId, tests, results.value);
  }

  /**
   * Records a run's results: each test's state, the tests only the run found, and a run's problem. A
   * test the run was asked for that reported nothing did not run, and loses its last state.
   * @param pluginId The adapter.
   * @param asked The tests the run was asked for.
   * @param results The results.
   */
  private apply(pluginId: string, asked: readonly string[], results: TestRunResults): void {
    const states: Map<string, TestState> = new Map<string, TestState>(this.statesSignal());
    for (const key of asked) {
      states.delete(key);
    }
    const index: ReadonlyMap<string, TestEntry> = this.index();
    const found: Map<string, TestNode[]> = new Map<string, TestNode[]>(
      [...(this.found().get(pluginId) ?? new Map<string, readonly TestNode[]>())].map(
        ([parent, nodes]: [string, readonly TestNode[]]): [string, TestNode[]] => [
          parent,
          [...nodes],
        ],
      ),
    );
    for (const result of results.results) {
      const key: string = testKey(pluginId, result.id);
      if (!index.has(key)) {
        if (result.parentId === undefined) {
          continue;
        }
        const siblings: TestNode[] = found.get(result.parentId) ?? [];
        if (!siblings.some((node: TestNode): boolean => node.id === result.id)) {
          siblings.push(nodeOfResult(result));
        }
        found.set(result.parentId, siblings);
      }
      states.set(key, stateOf(result));
    }
    const nextFound: Map<string, ReadonlyMap<string, readonly TestNode[]>> = new Map<
      string,
      ReadonlyMap<string, readonly TestNode[]>
    >(this.found());
    nextFound.set(pluginId, found);
    this.found.set(nextFound);
    this.statesSignal.set(states);
    this.clearRunning(asked);
    if (results.problem !== undefined) {
      this.runProblemSignal.set(results.problem);
    }
  }

  /**
   * Moves tests from waiting to running.
   * @param tests The tests' keys.
   */
  private moveToRunning(tests: readonly string[]): void {
    const queued: Set<string> = new Set<string>(this.queuedSignal());
    const running: Set<string> = new Set<string>(this.runningSignal());
    for (const key of tests) {
      queued.delete(key);
      running.add(key);
    }
    this.queuedSignal.set(queued);
    this.runningSignal.set(running);
  }

  /**
   * Marks tests as no longer running.
   * @param tests The tests' keys.
   */
  private clearRunning(tests: readonly string[]): void {
    const running: Set<string> = new Set<string>(this.runningSignal());
    for (const key of tests) {
      running.delete(key);
    }
    this.runningSignal.set(running);
  }

  /**
   * Gets the keys of every test at or beneath nodes, or every test an adapter found when none is named.
   * @param pluginId The adapter.
   * @param ids The nodes' identifiers, or empty for all.
   * @returns Returns the tests' keys.
   */
  private testsOf(pluginId: string, ids: readonly string[]): readonly string[] {
    const index: ReadonlyMap<string, TestEntry> = this.index();
    if (ids.length === 0) {
      return [...index.values()]
        .filter(
          (entry: TestEntry): boolean => entry.pluginId === pluginId && entry.node.kind === 'test',
        )
        .map((entry: TestEntry): string => entry.key);
    }
    const keys: Set<string> = new Set<string>();
    for (const id of ids) {
      for (const key of index.get(testKey(pluginId, id))?.tests ?? []) {
        keys.add(key);
      }
    }
    return [...keys];
  }
}

/**
 * Reads a result as the state the panel keeps.
 * @param result The result.
 * @returns Returns the state.
 */
function stateOf(result: TestResult): TestState {
  return {
    outcome: result.outcome,
    ...(result.durationMs === undefined ? {} : { durationMs: result.durationMs }),
    ...(result.message === undefined ? {} : { message: result.message }),
    ...(result.stack === undefined ? {} : { stack: result.stack }),
    ...(result.output === undefined ? {} : { output: result.output }),
  };
}
