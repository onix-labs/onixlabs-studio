import { ChildProcess, spawn } from 'node:child_process';
import { RuntimeInstallKind } from '@shared/api/model-runtime-types';
import { logger } from '../../logger';
import { pidJournal } from '../../pid-journal';

/**
 * How long, in milliseconds, to wait for a freshly-spawned server to answer before giving up.
 */
const START_TIMEOUT_MS: number = 20_000;

/**
 * How often, in milliseconds, the health probe is retried while waiting for the server to come up.
 */
const HEALTH_POLL_MS: number = 250;

/**
 * How long, in milliseconds, a stopping server is given to exit before it is killed outright.
 */
const STOP_GRACE_MS: number = 5_000;

/**
 * Answers whether the server is currently reachable.
 */
export type HealthProbe = () => Promise<boolean>;

/**
 * Whether a server started from a given install should be stopped when Studio closes.
 *
 * Studio's own managed copy is stopped: nothing else on the machine uses it, so leaving it holding a
 * port, RAM and VRAM after Studio has gone is pure waste. A server run from the user's own install is
 * left up — Studio merely started it on their behalf, and it behaves as it would had they run
 * `ollama serve` themselves.
 *
 * This is only about *closing Studio*. An explicit stop is the user's instruction and always applies.
 * @param kind The install the running server was started from.
 * @returns Returns true when shutdown should stop the server.
 */
export function stopsOnShutdown(kind: RuntimeInstallKind): boolean {
  return kind === 'managed';
}

/**
 * Starts and stops an Ollama server process on Studio's behalf.
 *
 * Studio only ever stops a server it started. A server the user is running themselves — the macOS
 * menubar app, a systemd unit, a terminal they left open — is something Studio can talk to but has no
 * business killing, so {@link OllamaServer.stop} refuses when it holds no child. The manager surfaces
 * that through `startedByStudio` on the status rather than offering a control that would not work.
 *
 * **Shutdown differs by which binary was started.** A server run from the user's *own* install stays
 * up when Studio closes: Studio only started it on their behalf, and it behaves exactly as it would
 * had they run `ollama serve` themselves. A server run from Studio's *managed* copy is stopped,
 * because nothing else on the machine uses that copy and leaving it would hold a port and VRAM for
 * nothing. {@link OllamaServer.stop} — the user explicitly asking — always stops either.
 *
 * A spawned server is registered with the {@link pidJournal} while Studio owns it, so a crash does not
 * leave an orphan. One that is deliberately left running is unregistered first, or the journal's reap
 * would kill it on the next launch.
 */
export class OllamaServer {
  /**
   * The server process Studio spawned, or null when it did not spawn one.
   */
  private child: ChildProcess | null = null;

  /**
   * Which kind of install the running server was started from, which decides whether it outlives
   * Studio. Meaningless while {@link child} is null.
   */
  private startedKind: RuntimeInstallKind = 'system';

  /**
   * The health probe used to decide when a spawned server is ready.
   */
  private readonly probe: HealthProbe;

  /**
   * The `OLLAMA_HOST` value a spawned server is told to listen on.
   */
  private readonly host: string;

  /**
   * Initializes a new instance of the {@link OllamaServer} class.
   * @param host The host[:port] the server should listen on.
   * @param probe Answers whether the server is reachable.
   */
  public constructor(host: string, probe: HealthProbe) {
    this.host = host;
    this.probe = probe;
  }

  /**
   * Whether the running server is the one Studio started.
   * @returns Returns true when Studio owns the server process.
   */
  public isOwned(): boolean {
    return this.child !== null;
  }

  /**
   * Starts the server and waits for it to answer. A server that is already reachable — whoever started
   * it — is left alone and reported as started.
   * @param executable The runtime executable to launch.
   * @param kind Whether the executable is the user's own install or Studio's managed copy, which
   * decides whether the server outlives Studio (see {@link dispose}).
   * @returns Returns true once the server answers.
   */
  public async start(executable: string, kind: RuntimeInstallKind = 'system'): Promise<boolean> {
    if (await this.probe()) {
      logger.debug('OllamaServer', 'Server already reachable; nothing to start');
      return true;
    }
    if (this.child !== null) {
      return this.waitUntilHealthy();
    }

    logger.info('OllamaServer', `Starting Ollama server: ${executable} serve (${this.host})`);
    let child: ChildProcess;
    try {
      child = spawn(executable, ['serve'], {
        env: { ...process.env, OLLAMA_HOST: this.host },
        stdio: 'ignore',
        windowsHide: true,
        // Detached so a server that is meant to outlive Studio is not in Studio's process group and
        // cannot be taken down with it. A managed server is killed explicitly on disposal instead.
        detached: kind === 'system',
      });
      if (kind === 'system') {
        // Nothing waits on it, so let the event loop close without it.
        child.unref();
      }
    } catch (error: unknown) {
      logger.error('OllamaServer', 'Failed to spawn the Ollama server', error);
      return false;
    }

    child.on('error', (error: Error): void => {
      logger.error('OllamaServer', 'Ollama server process errored', error);
    });
    child.on('exit', (code: number | null): void => {
      logger.info('OllamaServer', `Ollama server exited (code ${code ?? 'unknown'})`);
      pidJournal()?.unregister(child.pid);
      if (this.child === child) {
        this.child = null;
      }
    });

    this.child = child;
    this.startedKind = kind;

    // Only a server Studio intends to stop is registered. The journal exists to reap orphans a dead
    // run left behind, and it kills them on the next launch — so registering a server that is *meant*
    // to outlive Studio would have the reaper shoot it moments after Studio came back. Leaving it
    // unregistered is also the robust choice: unregistering on shutdown would depend on a graceful
    // quit, and a crash or a force-kill would then take the user's own server down with it.
    if (stopsOnShutdown(kind)) {
      pidJournal()?.register(child.pid, 'model-runtime', executable);
    }

    const healthy: boolean = await this.waitUntilHealthy();
    if (!healthy) {
      logger.warn('OllamaServer', 'Ollama server did not answer in time; stopping it again');
      await this.stop();
    }
    return healthy;
  }

  /**
   * Stops the server Studio started. Refuses when Studio did not start it.
   * @returns Returns true when a Studio-owned server was stopped.
   */
  public async stop(): Promise<boolean> {
    const child: ChildProcess | null = this.child;
    if (child === null) {
      logger.debug('OllamaServer', 'Refusing to stop a server Studio did not start');
      return false;
    }

    logger.info('OllamaServer', 'Stopping the Studio-started Ollama server');
    this.child = null;
    const exited: Promise<void> = new Promise<void>((resolve: () => void): void => {
      child.once('exit', (): void => resolve());
    });

    child.kill('SIGTERM');
    const timer: Promise<'timeout'> = new Promise<'timeout'>((resolve): void => {
      setTimeout((): void => resolve('timeout'), STOP_GRACE_MS);
    });
    if ((await Promise.race([exited.then((): 'exited' => 'exited'), timer])) === 'timeout') {
      logger.warn('OllamaServer', 'Ollama server ignored SIGTERM; killing it');
      child.kill('SIGKILL');
    }
    pidJournal()?.unregister(child.pid);
    return true;
  }

  /**
   * Stops a Studio-owned server without waiting, for application teardown.
   */
  public dispose(): void {
    const child: ChildProcess | null = this.child;
    if (child === null) {
      return;
    }
    this.child = null;

    if (stopsOnShutdown(this.startedKind)) {
      // Studio's own private copy: nothing else on the machine uses it, so leaving it holding a port,
      // RAM and VRAM after Studio has gone would be pure waste.
      logger.info('OllamaServer', 'Stopping the Studio-managed server on shutdown');
      child.kill('SIGTERM');
      pidJournal()?.unregister(child.pid);
      return;
    }

    // The user's own install: Studio merely started it on their behalf, so it stays up exactly as it
    // would had they run `ollama serve` themselves. It was never registered with the pid journal, so
    // there is nothing to release and nothing that will reap it on the next launch.
    logger.info('OllamaServer', 'Leaving the system-installed server running after shutdown');
  }

  /**
   * Polls the health probe until the server answers or the start timeout elapses.
   * @returns Returns true when the server answered in time.
   */
  private async waitUntilHealthy(): Promise<boolean> {
    const deadline: number = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await this.probe()) {
        return true;
      }
      await new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, HEALTH_POLL_MS);
      });
    }
    return false;
  }
}
