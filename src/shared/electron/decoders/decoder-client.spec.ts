import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CodeListing } from '@shared/api/code-listing';
import { DecoderDescription } from '@shared/api/decoder-protocol';
import { DecoderClient } from './decoder-client';
import { DecoderSpec } from './decoder-descriptor';

/**
 * Holds the directory the stub decoders are written into.
 */
let directory: string;

beforeAll((): void => {
  directory = mkdtempSync(join(tmpdir(), 'decoder-client-'));
});

afterAll((): void => {
  rmSync(directory, { recursive: true, force: true });
});

/**
 * Writes a stub decoder script and returns how to spawn it.
 *
 * A real child process rather than a mocked stream: the framing, the correlation and the exit handling
 * are the parts worth testing, and none of them are exercised by a fake that hands over whole messages.
 * @param name The script name.
 * @param body The script body.
 * @returns Returns the spawn specification.
 */
function stub(name: string, body: string): DecoderSpec {
  const file: string = join(directory, `${name}.cjs`);
  writeFileSync(file, body, 'utf8');
  return { command: process.execPath, args: [file] };
}

/**
 * Reads the process id of a started client's child, before disposal drops the reference.
 * @param client The started client.
 * @returns Returns the child's process id.
 */
function processIdOf(client: DecoderClient): number {
  const pid: number | undefined = (client as unknown as { process: { pid?: number } | null })
    .process?.pid;
  expect(pid).toBeTypeOf('number');
  return pid!;
}

/**
 * Reports whether a process still exists. Signal 0 performs the permission and existence checks
 * without delivering anything.
 * @param pid The process id to test.
 * @returns Returns true while the process is alive.
 */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Waits for a process to disappear.
 * @param pid The process id to watch.
 * @param timeoutMs How long to wait before giving up.
 * @returns Returns true when the process has gone, false when it outlasted the wait.
 */
async function waitForExit(pid: number, timeoutMs: number = 2_000): Promise<boolean> {
  const deadline: number = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!alive(pid)) {
      return true;
    }
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 50);
    });
  }
  return !alive(pid);
}

/**
 * Builds a stub that answers describe with a given protocol, and echoes a one-row listing for decode.
 * @param protocol The protocol version to announce.
 * @returns Returns the script body.
 */
function wellBehaved(protocol: string): string {
  return `
    let buffer = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\\n')) !== -1) {
        const line = buffer.slice(0, nl); buffer = buffer.slice(nl + 1);
        if (!line.trim()) continue;
        const request = JSON.parse(line);
        if (request.op === 'describe') {
          process.stdout.write(JSON.stringify({
            id: request.id, ok: true,
            description: { protocol: '${protocol}', formats: ['elf/x64'], requiresWholeFile: false },
          }) + '\\n');
        } else {
          process.stdout.write(JSON.stringify({
            id: request.id, ok: true,
            listing: {
              language: 'x64', addressing: 'file-offset',
              origin: { kind: 'buffer', path: request.path ?? null },
              sections: [{ id: 'native', title: '', rows: [
                { kind: 'instruction', address: request.baseOffset, fileOffset: request.baseOffset,
                  mnemonic: 'ret', operands: '', bytes: [195] },
              ] }],
            },
          }) + '\\n');
        }
      }
    });
  `;
}

describe('DecoderClient', (): void => {
  it('completes the describe handshake and reports what the decoder is', async (): Promise<void> => {
    const client: DecoderClient = new DecoderClient('good', stub('good', wellBehaved('1.0')));
    const description: DecoderDescription | null = await client.start();
    expect(description).not.toBeNull();
    expect(description?.formats).toEqual(['elf/x64']);
    client.dispose();
  });

  it('refuses a decoder speaking an incompatible protocol', async (): Promise<void> => {
    // A decoder that misreads a byte range returns a plausible wrong listing rather than an obvious
    // failure, so a major mismatch is refused rather than attempted.
    const client: DecoderClient = new DecoderClient('future', stub('future', wellBehaved('2.0')));
    expect(await client.start()).toBeNull();
    expect(client.describe()).toBeNull();
    client.dispose();
  });

  it('decodes and returns the listing, passing the base offset through', async (): Promise<void> => {
    const client: DecoderClient = new DecoderClient('decode', stub('decode', wellBehaved('1.0')));
    await client.start();
    const listing: CodeListing | null = await client.decode(
      'elf/x64',
      new Uint8Array([0xc3]),
      0x1000,
      undefined,
      '/tmp/a.out',
    );
    expect(listing?.sections[0].rows[0].fileOffset).toBe(0x1000);
    expect(listing?.origin).toEqual({ kind: 'buffer', path: '/tmp/a.out' });
    client.dispose();
  });

  it('refuses to decode before a successful handshake', async (): Promise<void> => {
    const client: DecoderClient = new DecoderClient(
      'unstarted',
      stub('unstarted', wellBehaved('1.0')),
    );
    expect(await client.decode('elf/x64', new Uint8Array([0xc3]), 0)).toBeNull();
    client.dispose();
  });

  it('reassembles a response split across chunks', async (): Promise<void> => {
    // A chunk boundary falls wherever the pipe decides, so a message routinely arrives in two pieces.
    // Parsing per chunk rather than per line would drop every message that did.
    const split: string = `
      const answer = JSON.stringify({
        id: 1, ok: true,
        description: { protocol: '1.0', formats: ['jvm'], requiresWholeFile: false },
      });
      process.stdin.resume();
      process.stdin.once('data', () => {
        process.stdout.write(answer.slice(0, 12));
        setTimeout(() => process.stdout.write(answer.slice(12) + '\\n'), 30);
      });
    `;
    const client: DecoderClient = new DecoderClient('split', stub('split', split));
    const description: DecoderDescription | null = await client.start();
    expect(description?.formats).toEqual(['jvm']);
    client.dispose();
  });

  it('ignores a line that is not JSON rather than failing the request', async (): Promise<void> => {
    const noisy: string = `
      const answer = JSON.stringify({
        id: 1, ok: true,
        description: { protocol: '1.0', formats: ['wasm'], requiresWholeFile: false },
      });
      process.stdin.resume();
      process.stdin.once('data', () => {
        process.stdout.write('this is not json\\n');
        process.stdout.write(answer + '\\n');
      });
    `;
    const client: DecoderClient = new DecoderClient('noisy', stub('noisy', noisy));
    expect((await client.start())?.formats).toEqual(['wasm']);
    client.dispose();
  });

  it('returns nothing when the decoder exits without answering', async (): Promise<void> => {
    const client: DecoderClient = new DecoderClient(
      'quitter',
      stub('quitter', 'process.stdin.resume(); process.exit(1);'),
    );
    expect(await client.start()).toBeNull();
    client.dispose();
  });

  it('fails in-flight requests when the decoder exits mid-conversation', async (): Promise<void> => {
    const dies: string = `
      let first = true;
      let buffer = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => {
        buffer += chunk;
        let nl;
        while ((nl = buffer.indexOf('\\n')) !== -1) {
          const line = buffer.slice(0, nl); buffer = buffer.slice(nl + 1);
          if (!line.trim()) continue;
          const request = JSON.parse(line);
          if (first) {
            first = false;
            process.stdout.write(JSON.stringify({
              id: request.id, ok: true,
              description: { protocol: '1.0', formats: ['elf/x64'], requiresWholeFile: false },
            }) + '\\n');
          } else {
            process.exit(3);
          }
        }
      });
    `;
    const client: DecoderClient = new DecoderClient('dies', stub('dies', dies));
    expect(await client.start()).not.toBeNull();
    // The decode must resolve rather than hang forever waiting on a process that is gone.
    expect(await client.decode('elf/x64', new Uint8Array([0xc3]), 0)).toBeNull();
    client.dispose();
  });

  it('returns nothing when the command cannot be spawned', async (): Promise<void> => {
    const client: DecoderClient = new DecoderClient('missing', {
      command: join(directory, 'does-not-exist'),
      args: [],
    });
    expect(await client.start()).toBeNull();
    client.dispose();
  });

  it('leaves no process behind when the decoder exits on being asked', async (): Promise<void> => {
    const client: DecoderClient = new DecoderClient('polite', stub('polite', wellBehaved('1.0')));
    expect(await client.start()).not.toBeNull();
    const pid: number = processIdOf(client);

    client.dispose();

    expect(await waitForExit(pid)).toBe(true);
  });

  it('kills a decoder that ignores being asked to stop, rather than leaving it running', async (): Promise<void> => {
    // A decoder wedged in a native call, or one with its own handler, does not go away on SIGTERM.
    // Nothing else would ever stop it, so the client must escalate (#583).
    const stubborn: string = `
        process.on('SIGTERM', () => {});
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk) => {
          for (const line of chunk.split('\\n')) {
            if (!line.trim()) continue;
            const request = JSON.parse(line);
            process.stdout.write(JSON.stringify({
              id: request.id, ok: true,
              description: { protocol: '1.0', formats: ['elf/x64'], requiresWholeFile: false },
            }) + '\\n');
          }
        });
        setInterval(() => {}, 1000);
      `;
    const client: DecoderClient = new DecoderClient('stubborn', stub('stubborn', stubborn));
    expect(await client.start()).not.toBeNull();
    const pid: number = processIdOf(client);

    client.dispose();

    // It survives the polite request, and is killed once the grace period passes.
    expect(alive(pid)).toBe(true);
    expect(await waitForExit(pid, 6_000)).toBe(true);
  }, 10_000);
});
