import { ChildProcess, spawn } from 'node:child_process';
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
 * Starts and stops an Ollama server process on Studio's behalf.
 *
 * Studio only ever stops a server it started. A server the user is running themselves — the macOS
 * menubar app, a systemd unit, a terminal they left open — is something Studio can talk to but has no
 * business killing, so {@link OllamaServer.stop} refuses when it holds no child. The manager surfaces
 * that through `startedByStudio` on the status rather than offering a control that would not work.
 *
 * A spawned server is registered with the {@link pidJournal}, so a Studio that crashes before it can
 * stop the child does not leave an orphaned server behind.
 */
export class OllamaServer {
  /**
   * The server process Studio spawned, or null when it did not spawn one.
   */
  private child: ChildProcess | null = null;

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
   * @returns Returns true once the server answers.
   */
  public async start(executable: string): Promise<boolean> {
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
      });
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
    pidJournal()?.register(child.pid, 'model-runtime', executable);

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
    if (this.child !== null) {
      this.child.kill('SIGTERM');
      pidJournal()?.unregister(this.child.pid);
      this.child = null;
    }
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
