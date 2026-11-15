import { ChildProcess, execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { CaptureCommand, captureCommand } from './capture-command';

/**
 * How a capture's tcpdump ended.
 */
export interface CaptureExit {
  /**
   * Gets its exit code, or null when a signal ended it.
   */
  readonly code: number | null;

  /**
   * Gets what it wrote to its error stream.
   */
  readonly errors: string;

  /**
   * Gets whether the user refused the permission it asked for, so it never ran.
   */
  readonly refused: boolean;
}

/**
 * A running tcpdump, however it was started: the pcap stream it writes, and how to stop it.
 */
export interface CaptureLaunch {
  /**
   * Gets the pcap stream. It ends once tcpdump has, after its last packet.
   */
  readonly packets: Readable;

  /**
   * Gets a promise resolving once tcpdump is listening. It never resolves when tcpdump does not get
   * that far.
   */
  readonly listening: Promise<void>;

  /**
   * Gets a promise resolving how tcpdump ended.
   */
  readonly exited: Promise<CaptureExit>;

  /**
   * Stops tcpdump the way Ctrl-C does, so it ends its stream whole.
   * @returns Returns a promise resolving once it has been told to.
   */
  stop(): Promise<void>;

  /**
   * Deletes whatever the launch made on disk.
   * @returns Returns a promise resolving once deleted.
   */
  dispose(): Promise<void>;
}

/**
 * Starts tcpdump on an interface. A seam, so the contribution can be tested without capturing
 * anything.
 */
export type CaptureLauncher = (interfaceId: string, filter: string) => Promise<CaptureLaunch>;

/**
 * Matches what tcpdump says once it has opened the interface.
 */
const LISTENING: RegExp = /listening on/i;

/**
 * How often an elevated capture's error file is read for tcpdump saying it is listening.
 */
const LISTENING_POLL_MS: number = 100;

/**
 * Matches an account name safe to hand to tcpdump's `-Z`.
 */
const ACCOUNT: RegExp = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * How long `cat` is given to read what tcpdump left in the FIFO once tcpdump has ended.
 */
const READER_GRACE_MS: number = 1000;

/**
 * How long tcpdump is given to end on SIGINT before it is killed.
 */
const STOP_GRACE_MS: number = 1500;

/**
 * Runs a command to completion.
 */
const run: (command: string, args: readonly string[]) => Promise<unknown> = promisify(execFile);

/**
 * Quotes a word for the POSIX shell: inside single quotes nothing is special but the quote itself.
 * @param word The word.
 * @returns Returns it quoted.
 */
export function shellQuote(word: string): string {
  return `'${word.replaceAll("'", `'\\''`)}'`;
}

/**
 * Builds the AppleScript that runs tcpdump as an administrator, writing to a FIFO and giving up root
 * to the user's account as soon as it has opened the interface. The shell records its pid before
 * becoming tcpdump, so the capture can be stopped once it is the user's own process.
 * @param tcpdump The tcpdump command, writing to the FIFO.
 * @param account The account tcpdump drops to.
 * @param directory The capture's private folder, where the pid and error files go.
 * @returns Returns the script.
 */
export function elevatedScript(
  tcpdump: CaptureCommand,
  account: string,
  directory: string,
): string {
  const words: readonly string[] = [tcpdump.command, '-Z', account, ...tcpdump.args];
  const shell: string =
    `echo $$ > ${shellQuote(join(directory, 'pid'))}; ` +
    `exec ${words.map(shellQuote).join(' ')} 2> ${shellQuote(join(directory, 'errors'))}`;
  const quoted: string = shell.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  return `do shell script "${quoted}" with administrator privileges`;
}

/**
 * Starts tcpdump directly, as the user, writing pcap to its standard output. It captures only where
 * the user's account may already read the interface.
 * @param interfaceId The interface, already validated.
 * @param filter The capture filter, already validated.
 * @param platform The operating system.
 * @returns Returns a promise resolving the launch.
 */
export function directLaunch(
  interfaceId: string,
  filter: string,
  platform: NodeJS.Platform,
): Promise<CaptureLaunch> {
  const command: CaptureCommand | undefined = captureCommand(interfaceId, filter, platform);
  if (command === undefined) {
    throw new Error('Capturing is not supported on this platform yet.');
  }
  const child: ChildProcess = spawn(command.command, [...command.args], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let errors: string = '';
  const listening: Promise<void> = new Promise<void>((resolve: () => void): void => {
    child.stderr?.on('data', (chunk: Buffer): void => {
      errors += chunk.toString('utf8');
      if (LISTENING.test(errors)) {
        resolve();
      }
    });
  });
  const exited: Promise<CaptureExit> = new Promise<CaptureExit>(
    (resolve: (exit: CaptureExit) => void): void => {
      child.once('error', (error: Error): void => {
        resolve({
          code: null,
          errors: `Could not start tcpdump: ${error.message}`,
          refused: false,
        });
      });
      child.once('close', (code: number | null): void => {
        resolve({ code, errors, refused: false });
      });
    },
  );
  return Promise.resolve({
    packets: child.stdout ?? Readable.from([]),
    listening,
    exited,
    stop: (): Promise<void> => {
      child.kill('SIGINT');
      return Promise.resolve();
    },
    dispose: (): Promise<void> => Promise.resolve(),
  });
}

/**
 * Starts tcpdump as an administrator on macOS, asking the user's permission with the system's own
 * dialog every time, so Studio never sees the password and no standing grant is left behind.
 *
 * tcpdump opens the interface as root and then becomes the user (`-Z`), writing to a FIFO in a
 * folder only the user can open. `cat` reads the FIFO, so the pcap arrives as an ordinary pipe and
 * the wait for tcpdump to open it blocks `cat`, never Node's thread pool.
 * @param interfaceId The interface, already validated.
 * @param filter The capture filter, already validated.
 * @param root The folder each capture's private folder is made in.
 * @returns Returns a promise resolving the launch.
 */
export async function elevatedLaunch(
  interfaceId: string,
  filter: string,
  root: string,
): Promise<CaptureLaunch> {
  const account: string = userInfo().username;
  if (!ACCOUNT.test(account)) {
    throw new Error('Your account name cannot be handed to tcpdump.');
  }
  await mkdir(root, { recursive: true, mode: 0o700 });
  // mkdtemp makes the folder readable only by the user.
  const directory: string = await mkdtemp(join(root, 'capture-'));
  const fifo: string = join(directory, 'packets');
  const tcpdump: CaptureCommand | undefined = captureCommand(interfaceId, filter, 'darwin', fifo);
  if (tcpdump === undefined) {
    throw new Error('Capturing is not supported on this platform yet.');
  }
  try {
    await run('/usr/bin/mkfifo', ['-m', '600', fifo]);
  } catch (error: unknown) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  const reader: ChildProcess = spawn('/bin/cat', [fifo], { stdio: ['ignore', 'pipe', 'ignore'] });
  const read: Promise<void> = new Promise<void>((resolve: () => void): void => {
    reader.once('close', (): void => resolve());
  });
  const child: ChildProcess = spawn(
    '/usr/bin/osascript',
    ['-e', elevatedScript(tcpdump, account, directory)],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let complaint: string = '';
  child.stderr?.on('data', (chunk: Buffer): void => {
    complaint += chunk.toString('utf8');
  });
  let ended: boolean = false;
  const errorsOf: () => Promise<string> = async (): Promise<string> => {
    try {
      return await readFile(join(directory, 'errors'), 'utf8');
    } catch {
      return '';
    }
  };
  const listening: Promise<void> = new Promise<void>((resolve: () => void): void => {
    const poll: () => Promise<void> = async (): Promise<void> => {
      if (ended) {
        return;
      }
      if (LISTENING.test(await errorsOf())) {
        resolve();
        return;
      }
      setTimeout((): void => void poll(), LISTENING_POLL_MS);
    };
    void poll();
  });
  const exited: Promise<CaptureExit> = new Promise<CaptureExit>(
    (resolve: (exit: CaptureExit) => void): void => {
      const finish: (code: number | null, extra: string) => Promise<void> = async (
        code: number | null,
        extra: string,
      ): Promise<void> => {
        if (ended) {
          return;
        }
        ended = true;
        // With tcpdump gone, cat reads what is left and ends; when tcpdump never opened the FIFO,
        // cat would wait for it forever.
        const timeout: Promise<void> = new Promise<void>((done: () => void): void => {
          setTimeout(done, READER_GRACE_MS);
        });
        await Promise.race([read, timeout]);
        reader.kill('SIGTERM');
        // osascript reports a cancelled dialog as error -128.
        const refused: boolean = code !== 0 && complaint.includes('(-128)');
        const errors: string = (await errorsOf()) || extra || complaint;
        resolve({ code, errors, refused });
      };
      child.once('error', (error: Error): void => {
        void finish(null, `Could not ask for permission to capture: ${error.message}`);
      });
      child.once('close', (code: number | null): void => void finish(code, ''));
    },
  );
  const stop: () => Promise<void> = async (): Promise<void> => {
    if (ended) {
      return;
    }
    let pid: number = Number.NaN;
    try {
      pid = Number.parseInt(await readFile(join(directory, 'pid'), 'utf8'), 10);
    } catch {
      // No pid yet: the dialog is still up, and ending osascript takes it down.
    }
    if (!Number.isInteger(pid) || pid <= 1) {
      child.kill('SIGTERM');
      return;
    }
    try {
      process.kill(pid, 'SIGINT');
    } catch {
      // Still root, for the moment before -Z takes effect: ending the reader ends tcpdump instead,
      // at the next packet it writes.
      reader.kill('SIGTERM');
      return;
    }
    // tcpdump started through the authorization dialog inherits SIGINT, SIGTERM and SIGHUP ignored,
    // and no shell can restore them; with -U every packet is already written, so killing loses none.
    const grace: Promise<void> = new Promise<void>((done: () => void): void => {
      setTimeout(done, STOP_GRACE_MS);
    });
    await Promise.race([exited, grace]);
    if (!ended) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        reader.kill('SIGTERM');
      }
    }
  };
  return {
    packets: reader.stdout ?? Readable.from([]),
    listening,
    exited,
    stop,
    dispose: async (): Promise<void> => {
      if (ended) {
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}

/**
 * Picks how to start tcpdump on a platform: on macOS, as an administrator with the user's permission
 * each time; elsewhere, directly.
 * @param platform The operating system.
 * @param root The folder elevated captures make their private folders in.
 * @returns Returns the launcher.
 */
export function platformLauncher(platform: NodeJS.Platform, root: string): CaptureLauncher {
  return platform === 'darwin'
    ? (interfaceId: string, filter: string): Promise<CaptureLaunch> =>
        elevatedLaunch(interfaceId, filter, root)
    : (interfaceId: string, filter: string): Promise<CaptureLaunch> =>
        directLaunch(interfaceId, filter, platform);
}
