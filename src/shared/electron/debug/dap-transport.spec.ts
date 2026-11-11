import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, Server, Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DapTransport,
  StdioTransport,
  TcpClientTransport,
  TcpServerTransport,
} from './dap-transport';

/**
 * Waits for a condition.
 * @param condition The condition.
 * @param what What is being waited for.
 */
async function until(condition: () => boolean, what: string): Promise<void> {
  const deadline: number = Date.now() + 5_000;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${what}`);
    }
    await new Promise<void>((resolve: () => void): void => void setTimeout(resolve, 10));
  }
}

/**
 * Whether a process is alive.
 * @param pid The process.
 * @returns Returns true while it runs.
 */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(process.platform === 'win32')('dap transports', () => {
  let scratch: string = '';
  let transports: DapTransport[] = [];
  let servers: Server[] = [];

  /**
   * Writes a Node script.
   * @param source The script.
   * @returns Returns its path.
   */
  function script(source: string): string {
    const file: string = path.join(scratch, `script-${Math.random().toString(36).slice(2)}.cjs`);
    writeFileSync(file, source);
    return file;
  }

  /**
   * Collects what a transport receives as text, and how it closed.
   * @param transport The transport, kept for disposal after the spec.
   * @returns Returns the record.
   */
  function watch<T extends DapTransport>(transport: T): Watched<T> {
    transports.push(transport);
    const watched: Watched<T> = { transport, text: '', closed: [] };
    transport.onData((chunk: Uint8Array): void => {
      watched.text += Buffer.from(chunk).toString('utf8');
    });
    transport.onClose((code: number | null, signal: string | null): void => {
      watched.closed.push({ code, signal });
    });
    return watched;
  }

  /**
   * Starts a server on a free port.
   * @param onConnection What to do with each connection.
   * @returns Returns the port.
   */
  async function listening(onConnection: (socket: Socket) => void): Promise<number> {
    const server: Server = createServer(onConnection);
    servers.push(server);
    await new Promise<void>((resolve: () => void): void => {
      server.listen(0, '127.0.0.1', resolve);
    });
    return (server.address() as AddressInfo).port;
  }

  beforeEach(() => {
    scratch = mkdtempSync(path.join(tmpdir(), 'studio-dap-transport-'));
    transports = [];
    servers = [];
  });

  afterEach(async () => {
    vi.useRealTimers();
    for (const transport of transports) {
      transport.dispose();
    }
    await Promise.all(
      servers.map(
        (server: Server): Promise<void> =>
          new Promise<void>((resolve: () => void): void => void server.close(() => resolve())),
      ),
    );
    rmSync(scratch, { recursive: true, force: true });
  });

  describe('StdioTransport', () => {
    const echo: string = "process.stdin.on('data', (chunk) => process.stdout.write(chunk));";

    it('carriesBytesBothWays_inTheCwdAndEnvironmentItWasGiven', async () => {
      const report: string = script(
        `process.stdout.write(process.cwd() + '|' + process.env.STUDIO_MARK + '|');${echo}`,
      );
      const cwd: string = path.join(scratch, 'cwd');
      mkdirSync(cwd);
      const stdio: Watched<StdioTransport> = watch(
        new StdioTransport(process.execPath, [report], { STUDIO_MARK: 'set' }, cwd),
      );

      await stdio.transport.start();
      stdio.transport.send('ping');
      await until((): boolean => stdio.text.endsWith('ping'), 'the echo');

      expect(stdio.text.split('|')[1]).toBe('set');
    });

    it('rejectsStart_whenTheProgramCannotBeRun', async () => {
      const stdio: Watched<StdioTransport> = watch(
        new StdioTransport(path.join(scratch, 'no-such-adapter'), [], undefined, scratch),
      );

      await expect(stdio.transport.start()).rejects.toThrow(/ENOENT/);
    });

    it('reportsAnExit_withItsCode', async () => {
      const stdio: Watched<StdioTransport> = watch(
        new StdioTransport(process.execPath, [script('process.exit(4);')], undefined, scratch),
      );

      await stdio.transport.start();
      await until((): boolean => stdio.closed.length > 0, 'the exit');

      expect(stdio.closed).toEqual([{ code: 4, signal: null }]);
    });

    it('survivesAWriteToAnAdapterThatHasGone', async () => {
      // An unhandled stream error here is an uncaught exception, which fails the run.
      const stdio: Watched<StdioTransport> = watch(
        new StdioTransport(process.execPath, [script('process.exit(0);')], undefined, scratch),
      );
      await stdio.transport.start();
      await until((): boolean => stdio.closed.length > 0, 'the exit');

      stdio.transport.send('too late');
      stdio.transport.send('still too late');
      await new Promise<void>((resolve: () => void): void => void setTimeout(resolve, 50));

      expect(stdio.closed).toHaveLength(1);
    });

    it('survivesAWriteToAnAdapterThatClosedItsInput', async () => {
      const stdio: Watched<StdioTransport> = watch(
        new StdioTransport(
          process.execPath,
          [
            script(
              `require('node:fs').closeSync(0);console.log('ready');setInterval(() => undefined, 1000);`,
            ),
          ],
          undefined,
          scratch,
        ),
      );
      await stdio.transport.start();
      await until((): boolean => stdio.text.includes('ready'), 'the adapter');

      stdio.transport.send('nobody is reading');
      await new Promise<void>((resolve: () => void): void => void setTimeout(resolve, 50));

      expect(stdio.closed).toEqual([]);
    });

    it('ignoresASendBeforeStart', () => {
      const stdio: Watched<StdioTransport> = watch(
        new StdioTransport(process.execPath, [], undefined, scratch),
      );

      expect((): void => stdio.transport.send('early')).not.toThrow();
    });

    it('disposeEndsTheAdapterAndItsDebuggee_andIsSafeToRepeat', async () => {
      const pids: string = path.join(scratch, 'pids');
      const parent: string = script(`
        const { spawn } = require('node:child_process');
        const child = spawn(process.execPath, ['-e', 'setInterval(() => undefined, 1000)'], { stdio: 'ignore' });
        require('node:fs').writeFileSync(${JSON.stringify(pids)}, process.pid + ' ' + child.pid);
        setInterval(() => undefined, 1000);
      `);
      const stdio: Watched<StdioTransport> = watch(
        new StdioTransport(process.execPath, [parent], undefined, scratch),
      );
      await stdio.transport.start();
      await until((): boolean => {
        try {
          return readFileSync(pids, 'utf8').includes(' ');
        } catch {
          return false;
        }
      }, 'the process tree');
      const tree: number[] = readFileSync(pids, 'utf8').split(' ').map(Number);

      stdio.transport.dispose();
      stdio.transport.dispose();

      await until(
        (): boolean => tree.every((pid: number): boolean => !alive(pid)),
        'the tree to end',
      );
    });
  });

  describe('TcpServerTransport', () => {
    /**
     * Builds a transport over a script.
     * @param source The script.
     * @returns Returns the watched transport.
     */
    function server(source: string): Watched<TcpServerTransport> {
      return watch(new TcpServerTransport(process.execPath, [script(source)], undefined, scratch));
    }

    const idle: string = 'setInterval(() => undefined, 1000);';

    it('readsABannerSplitAcrossWrites_andConnects', async () => {
      const port: number = await listening((socket: Socket): void => void socket.write('hello'));
      const tcp: Watched<TcpServerTransport> = server(`
        process.stdout.write('Debug server lis');
        setTimeout(() => process.stdout.write('tening at 127.0.0.1:${port}\\n'), 30);
        ${idle}
      `);

      await tcp.transport.start();
      await until((): boolean => tcp.text === 'hello', 'the greeting');

      expect(tcp.transport.host).toBe('127.0.0.1');
      expect(tcp.transport.port).toBe(port);
    });

    it('assumesLoopback_whenTheBannerNamesOnlyAPort', async () => {
      const port: number = await listening((): void => undefined);
      const tcp: Watched<TcpServerTransport> = server(
        `console.log('Debug server listening at ${port}');${idle}`,
      );

      await tcp.transport.start();

      expect(tcp.transport.host).toBe('127.0.0.1');
    });

    it('sendsOverTheSocket', async () => {
      let received: string = '';
      const port: number = await listening((socket: Socket): void => {
        socket.on('data', (chunk: Buffer): void => {
          received += chunk.toString();
        });
      });
      const tcp: Watched<TcpServerTransport> = server(
        `console.log('listening at 127.0.0.1:${port}');${idle}`,
      );

      await tcp.transport.start();
      tcp.transport.send('framed');

      await until((): boolean => received === 'framed', 'the bytes');
    });

    it('connects_toTheServerDelveAnnounces_withItsColonAfterAt (#1211)', async () => {
      // `dlv dap --listen=127.0.0.1:0` prints exactly this.
      let connected: boolean = false;
      const port: number = await listening((): void => {
        connected = true;
      });
      const tcp: Watched<TcpServerTransport> = server(
        `console.log('DAP server listening at: 127.0.0.1:${port}');${idle}`,
      );

      await tcp.transport.start();

      expect(tcp.transport.port).toBe(port);
      await until((): boolean => connected, 'the connection');
    });

    it('rejectsStart_atOnce_whenTheServerDiesBeforeAnnouncing', async () => {
      const tcp: Watched<TcpServerTransport> = server(`process.exit(2);`);

      await expect(tcp.transport.start()).rejects.toThrow(/exited/);
    });

    it('rejectsStart_whenTheServerNeverAnnounces', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const tcp: Watched<TcpServerTransport> = server(idle);

      const started: Promise<void> = tcp.transport.start();
      const failed: Promise<void> = expect(started).rejects.toThrow('did not start listening');
      await vi.advanceTimersByTimeAsync(15_000);

      await failed;
    });

    it('rejectsStart_whenTheProgramCannotBeRun', async () => {
      const tcp: Watched<TcpServerTransport> = watch(
        new TcpServerTransport(path.join(scratch, 'no-such-node'), [], undefined, scratch),
      );

      await expect(tcp.transport.start()).rejects.toThrow(/ENOENT/);
    });

    it('rejectsStart_whenThePortRefusesTheConnection', async () => {
      const port: number = await listening((): void => undefined);
      const closing: Server | undefined = servers.pop();
      await new Promise<void>((resolve: () => void): void => void closing?.close(() => resolve()));
      const tcp: Watched<TcpServerTransport> = server(
        `console.log('listening at 127.0.0.1:${port}');${idle}`,
      );

      await expect(tcp.transport.start()).rejects.toThrow(/ECONNREFUSED/);
    });

    it('rejectsStart_forAnAnnouncedPortThatCannotExist', async () => {
      const tcp: Watched<TcpServerTransport> = server(
        `console.log('listening at 127.0.0.1:99999');${idle}`,
      );

      await expect(tcp.transport.start()).rejects.toThrow(/port/i);
    });

    it('reportsTheServerExiting_afterItIsUp', async () => {
      const port: number = await listening((): void => undefined);
      const tcp: Watched<TcpServerTransport> = server(
        `console.log('listening at 127.0.0.1:${port}');setTimeout(() => process.exit(5), 30);${idle}`,
      );

      await tcp.transport.start();
      await until((): boolean => tcp.closed.length > 0, 'the exit');

      expect(tcp.closed).toEqual([{ code: 5, signal: null }]);
    });

    it('disposeIsSafeToRepeat', async () => {
      const port: number = await listening((): void => undefined);
      const tcp: Watched<TcpServerTransport> = server(
        `console.log('listening at 127.0.0.1:${port}');${idle}`,
      );
      await tcp.transport.start();

      tcp.transport.dispose();

      expect((): void => tcp.transport.dispose()).not.toThrow();
      expect((): void => tcp.transport.send('after')).not.toThrow();
    });
  });

  describe('TcpClientTransport', () => {
    it('carriesBytes_andReportsAClose', async () => {
      const port: number = await listening((socket: Socket): void => {
        socket.end('bye');
      });
      const client: Watched<TcpClientTransport> = watch(new TcpClientTransport('127.0.0.1', port));

      await client.transport.start();
      await until((): boolean => client.closed.length > 0, 'the close');

      expect(client.text).toBe('bye');
      expect(client.closed).toEqual([{ code: null, signal: null }]);
    });

    it('rejectsStart_whenRefused', async () => {
      const port: number = await listening((): void => undefined);
      const closing: Server | undefined = servers.pop();
      await new Promise<void>((resolve: () => void): void => void closing?.close(() => resolve()));
      const client: Watched<TcpClientTransport> = watch(new TcpClientTransport('127.0.0.1', port));

      await expect(client.transport.start()).rejects.toThrow(/ECONNREFUSED/);
    });

    it('disposeIsSafeToRepeat_andSendAfterwardsIsIgnored', async () => {
      const port: number = await listening((): void => undefined);
      const client: Watched<TcpClientTransport> = watch(new TcpClientTransport('127.0.0.1', port));
      await client.transport.start();

      client.transport.dispose();
      client.transport.dispose();

      expect((): void => client.transport.send('after')).not.toThrow();
    });
  });
});

/**
 * What a spec saw of a transport.
 */
interface Watched<T extends DapTransport> {
  readonly transport: T;
  text: string;
  readonly closed: { code: number | null; signal: string | null }[];
}
