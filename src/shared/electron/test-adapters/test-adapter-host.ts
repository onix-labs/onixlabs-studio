import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  TEST_OP_CAPABILITY,
  TestAdapterCapability,
  TestAdapterDescription,
  TestAdapterOp,
  TestAdapterParams,
  TestAdapterResponse,
  TestCommand,
  TestDebugLaunch,
  TestDiscovery,
  TestRunResults,
} from '@shared/api/test-adapter-protocol';
import type {
  TestAdapterInfo,
  TestDebugPlanAnswer,
  TestDiscoverAnswer,
  TestHostAnswer,
  TestResultsAnswer,
  TestRunPlanAnswer,
} from '@shared/api/test-channels';
import type { RepositoryTrustDecision } from '@shared/api/source-control-channels';
import { logger } from '../logger';
import { TestAdapterClient } from './test-adapter-client';
import {
  TestAdapterDescriptor,
  TestAdapterResolution,
  TestAdapterSpec,
} from './test-adapter-descriptor';
import { TestAdapterEndpoint } from './test-adapter-endpoint';
import {
  checkCommand,
  checkDebugLaunch,
  checkDiscovery,
  checkResults,
  cutTranscript,
} from './test-adapter-checks';
import { DirectoryEntry, folderHoldsMarker } from './marker-scan';

/**
 * Specifies how long discovering a folder's tests may take: a plugin reads every test file of a large
 * solution.
 */
const DISCOVER_TIMEOUT_MS: number = 2 * 60_000;

/**
 * Specifies how long planning a run or a launch, or reading its results, may take.
 */
const REQUEST_TIMEOUT_MS: number = 60_000;

/**
 * Specifies how many planned runs may await their results at once. A renderer that plans and never
 * reports cannot fill the disk with output folders: the oldest is forgotten first.
 */
const MAX_OUTSTANDING_RUNS: number = 32;

/**
 * Specifies how many test identifiers one run may name.
 */
const MAX_RUN_IDS: number = 10_000;

/**
 * The part of the open-workspace registry a request's folder is checked against.
 */
export interface TestAdapterRoots {
  /**
   * Determines whether a path is an open workspace root or lies inside one.
   * @param target The path to test.
   * @returns Returns true when the path is within an open workspace root.
   */
  isWithin(target: unknown): boolean;
}

/**
 * The part of the repository-trust store a request's folder is checked against.
 */
export interface TestAdapterTrustSource {
  /**
   * Gets what the user decided about a folder, or `unknown` when they have not been asked.
   * @param target The folder to test.
   * @returns Returns the decision in force for the folder.
   */
  decisionFor(target: unknown): RepositoryTrustDecision;
}

/**
 * Describes what the host depends on, injectable so it is testable without processes or a disk.
 */
export interface TestAdapterHostOptions {
  /**
   * Gets the contributed test-adapter plugins, read afresh each time so an install or uninstall is seen
   * without a restart.
   */
  readonly descriptors: () => readonly TestAdapterDescriptor[];

  /**
   * Gets the open workspace roots every folder must lie within.
   */
  readonly roots: TestAdapterRoots;

  /**
   * Gets whether the user trusts each folder's contents. ⛔ An adapter is started for a folder only once
   * the user has said so: running a folder's tests runs its code, and even reading it names the tools
   * a run would start.
   */
  readonly trust: TestAdapterTrustSource;

  /**
   * Makes an empty folder for one run's output, outside every workspace. Defaults to the system's
   * temporary directory.
   */
  readonly makeRunDirectory?: () => Promise<string>;

  /**
   * Removes a run's output folder. Defaults to the filesystem.
   */
  readonly removeDirectory?: (directory: string) => Promise<void>;

  /**
   * Lists a directory for the marker scan. Defaults to the filesystem.
   */
  readonly listDirectory?: (directory: string) => Promise<readonly DirectoryEntry[]>;

  /**
   * Creates the client for a plugin's process. Defaults to a real process.
   */
  readonly createClient?: (id: string, spec: TestAdapterSpec) => TestAdapterEndpoint;
}

/**
 * Describes a running plugin and what it may be asked.
 */
interface RunningAdapter {
  /**
   * Gets the endpoint answering for the plugin.
   */
  readonly client: TestAdapterEndpoint;

  /**
   * Gets the capabilities both the manifest declared and the handshake confirmed.
   */
  readonly capabilities: readonly TestAdapterCapability[];

  /**
   * Gets what the plugin said it is.
   */
  readonly description: TestAdapterDescription;
}

/**
 * Describes a planned run or launch awaiting its end.
 */
interface PlannedRun {
  /**
   * Gets the plugin it was planned by.
   */
  readonly pluginId: string;

  /**
   * Gets the folder it runs in.
   */
  readonly root: string;

  /**
   * Gets the tests it was asked for, as sent to the plugin.
   */
  readonly ids: readonly string[];

  /**
   * Gets its output folder.
   */
  readonly outputDirectory: string;
}

/**
 * Hosts the test-adapter plugins in the main process (#1351): finds which ones apply to a folder,
 * starts each on first use, and stands between it and an untrusted renderer.
 *
 * Several adapters can apply to one folder — a repository can hold a .NET solution and a JavaScript
 * package — so like the package-manager host this one never picks, and each request names its plugin.
 *
 * ⛔ Every check lives here rather than in the plugin, because a plugin is code Studio did not write:
 * - a request's folder must be absolute, lie within an open workspace root, and be trusted;
 * - a request needing a capability the plugin did not both declare and confirm is refused without the
 *   plugin ever seeing it, and a run is widened to every test when the plugin cannot narrow it;
 * - each run gets its own output folder outside the workspace, which the renderer never names: results
 *   are read back by the run's identifier, so a renderer cannot point a plugin at another folder;
 * - a command or launch a plugin answers with is started by Studio, so it must be well formed and stay
 *   inside the folder, or it is refused;
 * - a tree or results reaching the renderer are bounded, narrowed to the protocol's shape, and link
 *   only into the folder.
 */
export class TestAdapterHost {
  /**
   * Holds the dependencies.
   */
  private readonly options: TestAdapterHostOptions;

  /**
   * Holds the running plugins, keyed by plugin id.
   */
  private readonly running: Map<string, RunningAdapter> = new Map<string, RunningAdapter>();

  /**
   * Holds the starts in progress, keyed by plugin id, so two first requests start one process.
   */
  private readonly starting: Map<string, Promise<RunningAdapter | string>> = new Map<
    string,
    Promise<RunningAdapter | string>
  >();

  /**
   * Holds how many times each plugin has been restarted, so a start already under way when it was
   * restarted is recognised as stale when it finishes (#881).
   */
  private readonly generations: Map<string, number> = new Map<string, number>();

  /**
   * Holds the planned runs and launches awaiting their end, oldest first.
   */
  private readonly runs: Map<string, PlannedRun> = new Map<string, PlannedRun>();

  /**
   * Initializes the host.
   * @param options What the host depends on.
   */
  public constructor(options: TestAdapterHostOptions) {
    this.options = options;
  }

  /**
   * Lists every adapter a folder applies to — whose marker the folder holds, or a directory shallowly
   * under it — installed or not, so the panel can offer the install. Confined to the open workspace
   * roots: an answer reveals whether a file exists, which is not the renderer's to ask anywhere on disk.
   * @param root The absolute folder.
   * @returns Returns the adapters, highest priority first; empty when none applies or it is not open.
   */
  public async adaptersFor(root: unknown): Promise<readonly TestAdapterInfo[]> {
    if (this.refuseRoot(root) !== null) {
      return [];
    }
    const descriptors: readonly TestAdapterDescriptor[] = this.preferredOrder();
    if (descriptors.length === 0) {
      return [];
    }
    const markers: readonly string[] = descriptors.flatMap(
      (descriptor: TestAdapterDescriptor): readonly string[] => descriptor.markers,
    );
    const held: (marker: string) => boolean = await folderHoldsMarker(
      path.resolve(root as string),
      markers,
      this.options.listDirectory,
    );
    return descriptors
      .filter((descriptor: TestAdapterDescriptor): boolean => descriptor.markers.some(held))
      .map((descriptor: TestAdapterDescriptor): TestAdapterInfo => ({
        pluginId: descriptor.id,
        displayName: descriptor.displayName,
        frameworks: descriptor.frameworks,
        installed: descriptor.resolve().available,
        capabilities: descriptor.capabilities,
      }));
  }

  /**
   * Gets every contributed adapter, highest priority first.
   * @returns Returns the descriptors.
   */
  public preferredOrder(): readonly TestAdapterDescriptor[] {
    return [...this.options.descriptors()].sort(
      (a: TestAdapterDescriptor, b: TestAdapterDescriptor): number => b.priority - a.priority,
    );
  }

  /**
   * Finds a folder's tests through one adapter.
   * @param pluginId The adapter.
   * @param root The absolute folder.
   * @returns Returns the checked tree, or the reason there is none.
   */
  public async discover(pluginId: unknown, root: unknown): Promise<TestDiscoverAnswer> {
    const target: Target | TestHostAnswer<never> = this.target(pluginId, root);
    if ('ok' in target) {
      return target;
    }
    const response: TestAdapterResponse<'discover'> = await this.send(
      target,
      'discover',
      {},
      DISCOVER_TIMEOUT_MS,
    );
    if (!response.ok) {
      return failure(response);
    }
    const discovery: TestDiscovery | null = checkDiscovery(response.result, target.root);
    return discovery === null
      ? refused(`${target.descriptor.displayName} answered with something that is not a test tree.`)
      : { ok: true, value: discovery };
  }

  /**
   * Plans a run: makes its output folder and asks the adapter for the command. A plugin that cannot
   * narrow a run is sent no identifiers, so it runs every test, and the plan says so.
   * @param pluginId The adapter.
   * @param root The absolute folder.
   * @param ids The tests to run, by node identifier, or empty for all.
   * @returns Returns the checked command and the run's identifier, or the reason there is none.
   */
  public async planRun(pluginId: unknown, root: unknown, ids: unknown): Promise<TestRunPlanAnswer> {
    const target: Target | TestHostAnswer<never> = this.target(pluginId, root);
    if ('ok' in target) {
      return target;
    }
    const asked: readonly string[] | null = readIds(ids);
    if (asked === null) {
      return refused('The tests to run are not a list of identifiers.');
    }
    const adapter: RunningAdapter | string = await this.ensure(target.descriptor);
    if (typeof adapter === 'string') {
      return { ok: false, error: adapter };
    }
    const selected: boolean = asked.length > 0 && adapter.capabilities.includes('runSelected');
    const sent: readonly string[] = selected ? asked : [];
    const outputDirectory: string = await this.makeRunDirectory();
    const response: TestAdapterResponse<'run'> = await this.send(
      target,
      'run',
      { ids: sent, outputDirectory },
      REQUEST_TIMEOUT_MS,
    );
    if (!response.ok) {
      await this.remove(outputDirectory);
      return failure(response);
    }
    const command: TestCommand | null = checkCommand(response.result, target.root);
    if (command === null) {
      await this.remove(outputDirectory);
      logger.warn(
        'TestAdapterHost',
        `${target.descriptor.id} answered a run with a command it may not run`,
      );
      return refused('The plugin answered with a command Studio will not run.');
    }
    const runId: string = this.remember({
      pluginId: target.descriptor.id,
      root: target.root,
      ids: sent,
      outputDirectory,
    });
    return { ok: true, value: { runId, command, selected: selected || asked.length === 0 } };
  }

  /**
   * Reads how a planned run came out, then forgets it and removes its output folder.
   * @param runId The run, as {@link planRun} named it.
   * @param exitCode The command's exit code, or -1 when it was stopped or never started.
   * @param transcript What the command printed.
   * @returns Returns the checked results, or the reason there are none.
   */
  public async results(
    runId: unknown,
    exitCode: unknown,
    transcript: unknown,
  ): Promise<TestResultsAnswer> {
    const run: PlannedRun | undefined =
      typeof runId === 'string' ? this.runs.get(runId) : undefined;
    if (run === undefined) {
      return refused('That run is not one Studio planned, or it has already reported.');
    }
    this.runs.delete(runId as string);
    try {
      const target: Target | TestHostAnswer<never> = this.target(run.pluginId, run.root);
      if ('ok' in target) {
        return target;
      }
      const response: TestAdapterResponse<'results'> = await this.send(
        target,
        'results',
        {
          ids: run.ids,
          outputDirectory: run.outputDirectory,
          exitCode: typeof exitCode === 'number' && Number.isInteger(exitCode) ? exitCode : -1,
          output: cutTranscript(transcript),
        },
        REQUEST_TIMEOUT_MS,
      );
      if (!response.ok) {
        return failure(response);
      }
      const results: TestRunResults | null = checkResults(response.result, run.root);
      return results === null
        ? refused(`${target.descriptor.displayName} answered with something that is not results.`)
        : { ok: true, value: results };
    } finally {
      await this.remove(run.outputDirectory);
    }
  }

  /**
   * Plans a debug launch of one test.
   * @param pluginId The adapter.
   * @param root The absolute folder.
   * @param id The test, by node identifier.
   * @returns Returns the checked launch and its identifier, or the reason there is none.
   */
  public async planDebug(
    pluginId: unknown,
    root: unknown,
    id: unknown,
  ): Promise<TestDebugPlanAnswer> {
    const target: Target | TestHostAnswer<never> = this.target(pluginId, root);
    if ('ok' in target) {
      return target;
    }
    if (typeof id !== 'string' || id.length === 0) {
      return refused('The test to debug is not an identifier.');
    }
    const outputDirectory: string = await this.makeRunDirectory();
    const response: TestAdapterResponse<'debug'> = await this.send(
      target,
      'debug',
      { id, outputDirectory },
      REQUEST_TIMEOUT_MS,
    );
    if (!response.ok) {
      await this.remove(outputDirectory);
      return failure(response);
    }
    const launch: TestDebugLaunch | null = checkDebugLaunch(response.result, target.root);
    if (launch === null) {
      await this.remove(outputDirectory);
      logger.warn(
        'TestAdapterHost',
        `${target.descriptor.id} answered a debug request with a launch it may not start`,
      );
      return refused('The plugin answered with a debug launch Studio will not start.');
    }
    const runId: string = this.remember({
      pluginId: target.descriptor.id,
      root: target.root,
      ids: [id],
      outputDirectory,
    });
    return { ok: true, value: { runId, launch } };
  }

  /**
   * Forgets a planned run or launch that will not report — stopped before it started, or a debug session
   * that ended — and removes its output folder.
   * @param runId The run.
   */
  public async finish(runId: unknown): Promise<void> {
    const run: PlannedRun | undefined =
      typeof runId === 'string' ? this.runs.get(runId) : undefined;
    if (run === undefined) {
      return;
    }
    this.runs.delete(runId as string);
    await this.remove(run.outputDirectory);
  }

  /**
   * Stops a plugin, so the next request starts it afresh — after it was updated or removed (#881).
   * @param pluginId The plugin.
   */
  public restartPlugin(pluginId: string): void {
    this.generations.set(pluginId, (this.generations.get(pluginId) ?? 0) + 1);
    this.running.get(pluginId)?.client.dispose();
    this.running.delete(pluginId);
    this.starting.delete(pluginId);
  }

  /**
   * Stops every running plugin and removes every output folder still held.
   */
  public dispose(): void {
    for (const adapter of this.running.values()) {
      adapter.client.dispose();
    }
    this.running.clear();
    this.starting.clear();
    for (const run of this.runs.values()) {
      void this.remove(run.outputDirectory);
    }
    this.runs.clear();
  }

  /**
   * Checks a request's plugin and folder: an installed contribution, and an open, trusted folder.
   * @param pluginId The plugin, untrusted.
   * @param root The folder, untrusted.
   * @returns Returns what the request is for, or the refusal.
   */
  private target(pluginId: unknown, root: unknown): Target | TestHostAnswer<never> {
    const refusal: string | null = this.refuseRoot(root);
    if (refusal !== null) {
      return refused(refusal);
    }
    const resolvedRoot: string = path.resolve(root as string);
    const decision: RepositoryTrustDecision = this.options.trust.decisionFor(resolvedRoot);
    if (decision !== 'trusted') {
      logger.debug('TestAdapterHost', `Refused a request in ${decision} folder ${resolvedRoot}`);
      return {
        ok: false,
        code: 'untrusted',
        error:
          decision === 'restricted'
            ? 'This folder is not trusted, so its tests are not read or run.'
            : 'This folder has not been trusted yet, so its tests are not read or run.',
      };
    }
    const descriptor: TestAdapterDescriptor | undefined =
      typeof pluginId === 'string'
        ? this.options
            .descriptors()
            .find((candidate: TestAdapterDescriptor): boolean => candidate.id === pluginId)
        : undefined;
    if (descriptor === undefined) {
      return refused(`No test-adapter plugin named ${String(pluginId)} is installed.`);
    }
    return { descriptor, root: resolvedRoot };
  }

  /**
   * Checks the capability and sends a request.
   * @param target The plugin and folder.
   * @param op The operation.
   * @param params The operation's parameters.
   * @param timeoutMs How long to wait.
   * @returns Returns the plugin's answer, or the host's refusal.
   */
  private async send<Op extends TestAdapterOp>(
    target: Target,
    op: Op,
    params: TestAdapterParams<Op>,
    timeoutMs: number,
  ): Promise<TestAdapterResponse<Op>> {
    const adapter: RunningAdapter | string = await this.ensure(target.descriptor);
    if (typeof adapter === 'string') {
      return { id: 0, ok: false, error: adapter };
    }
    const needed: TestAdapterCapability | undefined = TEST_OP_CAPABILITY[op];
    if (needed !== undefined && !adapter.capabilities.includes(needed)) {
      return {
        id: 0,
        ok: false,
        error: `${target.descriptor.displayName} does not support this (${needed}).`,
        code: 'unsupported',
      };
    }
    return adapter.client.request(op, target.root, params, timeoutMs);
  }

  /**
   * Gets a plugin's running instance, starting it when it is not running (or has exited).
   * @param descriptor The plugin.
   * @returns Returns the running plugin, or the reason it could not be started.
   */
  private ensure(descriptor: TestAdapterDescriptor): Promise<RunningAdapter | string> {
    const current: RunningAdapter | undefined = this.running.get(descriptor.id);
    if (current?.client.running === true) {
      // ⛔ Still installed, or nothing is served. A running process outlives its files (#881).
      if (descriptor.resolve().available) {
        return Promise.resolve(current);
      }
      logger.info(
        'TestAdapterHost',
        `${descriptor.id} is no longer installed; stopping its process`,
      );
      this.restartPlugin(descriptor.id);
    }
    this.running.delete(descriptor.id);
    const inProgress: Promise<RunningAdapter | string> | undefined = this.starting.get(
      descriptor.id,
    );
    if (inProgress !== undefined) {
      return inProgress;
    }
    const started: Promise<RunningAdapter | string> = this.start(descriptor).finally((): void => {
      if (this.starting.get(descriptor.id) === started) {
        this.starting.delete(descriptor.id);
      }
    });
    this.starting.set(descriptor.id, started);
    return started;
  }

  /**
   * Starts a plugin and records what it may be asked: the capabilities the manifest declared *and* the
   * handshake confirmed.
   * @param descriptor The plugin.
   * @returns Returns the running plugin, or the reason it could not be started.
   */
  private async start(descriptor: TestAdapterDescriptor): Promise<RunningAdapter | string> {
    const generation: number = this.generations.get(descriptor.id) ?? 0;
    const resolution: TestAdapterResolution = descriptor.resolve();
    if (!resolution.available) {
      return resolution.reason;
    }
    const client: TestAdapterEndpoint =
      this.options.createClient?.(descriptor.id, resolution.spec) ??
      new TestAdapterClient(descriptor.id, resolution.spec);
    const description: TestAdapterDescription | null = await client.start();
    if (description === null) {
      return `${descriptor.displayName} could not be started.`;
    }
    if ((this.generations.get(descriptor.id) ?? 0) !== generation) {
      logger.info('TestAdapterHost', `${descriptor.id} changed while starting; starting it afresh`);
      client.dispose();
      return this.ensure(descriptor);
    }
    if (description.problem !== undefined) {
      logger.info('TestAdapterHost', `${descriptor.id} reports: ${description.problem}`);
    }
    const adapter: RunningAdapter = {
      client,
      description,
      capabilities: description.capabilities.filter((capability: TestAdapterCapability) =>
        descriptor.capabilities.includes(capability),
      ),
    };
    this.running.set(descriptor.id, adapter);
    return adapter;
  }

  /**
   * Records a planned run, forgetting the oldest when too many await their end.
   * @param run The run.
   * @returns Returns its identifier.
   */
  private remember(run: PlannedRun): string {
    const runId: string = randomUUID();
    this.runs.set(runId, run);
    for (const [oldest, stale] of this.runs) {
      if (this.runs.size <= MAX_OUTSTANDING_RUNS) {
        break;
      }
      this.runs.delete(oldest);
      void this.remove(stale.outputDirectory);
    }
    return runId;
  }

  /**
   * Makes a run's output folder.
   * @returns Returns its absolute path.
   */
  private makeRunDirectory(): Promise<string> {
    return (this.options.makeRunDirectory ?? makeRunDirectory)();
  }

  /**
   * Removes a run's output folder, tolerating one already gone.
   * @param directory The folder.
   */
  private async remove(directory: string): Promise<void> {
    try {
      await (this.options.removeDirectory ?? removeDirectory)(directory);
    } catch (error: unknown) {
      logger.debug('TestAdapterHost', `Could not remove ${directory}`, error);
    }
  }

  /**
   * Checks a folder a request names: it must be absolute and lie within an open workspace root.
   * @param target The candidate folder.
   * @returns Returns the reason it is refused, or null when it is acceptable.
   */
  private refuseRoot(target: unknown): string | null {
    if (typeof target !== 'string' || target.includes('\0') || !path.isAbsolute(target)) {
      return 'The path is not absolute.';
    }
    return this.options.roots.isWithin(path.resolve(target))
      ? null
      : 'That folder is not an open workspace.';
  }
}

/**
 * Describes what a checked request is for.
 */
interface Target {
  /**
   * Gets the plugin.
   */
  readonly descriptor: TestAdapterDescriptor;

  /**
   * Gets the resolved folder.
   */
  readonly root: string;
}

/**
 * Builds the host's refusal.
 * @param error The reason.
 * @returns Returns the failure.
 */
function refused(error: string): TestHostAnswer<never> {
  return { ok: false, error, code: 'refused' };
}

/**
 * Passes a plugin's failure on in the host's shape.
 * @param response The failed response.
 * @returns Returns the failure.
 */
function failure(response: TestAdapterResponse & { readonly ok: false }): TestHostAnswer<never> {
  return {
    ok: false,
    error: response.error,
    ...(response.code === undefined ? {} : { code: response.code }),
  };
}

/**
 * Reads the identifiers a run names: a bounded list of non-empty strings.
 * @param value The candidate, untrusted.
 * @returns Returns the identifiers, or null when they are not a list of them.
 */
function readIds(value: unknown): readonly string[] | null {
  if (
    !Array.isArray(value) ||
    value.length > MAX_RUN_IDS ||
    !value.every((id: unknown): boolean => typeof id === 'string' && id.length > 0)
  ) {
    return null;
  }
  return value as readonly string[];
}

/**
 * Makes an empty folder for a run under the system's temporary directory.
 * @returns Returns its absolute, real path.
 */
async function makeRunDirectory(): Promise<string> {
  const parent: string = path.join(os.tmpdir(), 'onixlabs-studio-tests');
  await fs.mkdir(parent, { recursive: true });
  return fs.realpath(await fs.mkdtemp(path.join(parent, 'run-')));
}

/**
 * Removes a run's folder and everything in it.
 * @param directory The folder.
 */
async function removeDirectory(directory: string): Promise<void> {
  await fs.rm(directory, { recursive: true, force: true });
}
