import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CodeListing } from '@shared/api/code-listing';
import { DecoderDescriptor, DecoderResolution } from './decoder-descriptor';
import { DecoderRegistry } from './decoder-registry';
import { Decoders } from './decoders';

/**
 * The format the stubs decode.
 */
const FORMAT: string = 'elf/x64';

/**
 * Builds a stub decoder that notes each start, answers describe, and answers decode with a listing, or
 * by dying when the bytes open with 0xff.
 * @param startLog The file each start is noted in.
 * @param ready How long, in milliseconds, it takes to answer describe.
 * @returns Returns the script body.
 */
function stubDecoder(startLog: string, ready: number = 0): string {
  return `
    require('node:fs').appendFileSync(${JSON.stringify(startLog)}, process.pid + '\\n');
    let buffer = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('end', () => process.exit(0));
    process.stdin.on('data', (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\\n')) !== -1) {
        const line = buffer.slice(0, nl); buffer = buffer.slice(nl + 1);
        if (!line.trim()) continue;
        const request = JSON.parse(line);
        if (request.op === 'describe') {
          setTimeout(() => process.stdout.write(JSON.stringify({
            id: request.id, ok: true,
            description: { protocol: '1.0', formats: ['${FORMAT}'], requiresWholeFile: false },
          }) + '\\n'), ${ready});
        } else if (Buffer.from(request.bytes, 'base64')[0] === 0xff) {
          process.exit(7);
        } else {
          process.stdout.write(JSON.stringify({
            id: request.id, ok: true,
            listing: { language: 'x64', addressing: 'file-offset',
              origin: { kind: 'buffer', path: null }, sections: [] },
          }) + '\\n');
        }
      }
    });
  `;
}

describe('Decoders', () => {
  let directory: string;
  let startLog: string;
  let script: string;
  let resolution: () => DecoderResolution;
  let registry: DecoderRegistry;
  let decoders: Decoders;

  /**
   * Lists the processes the stub has been started as.
   * @returns Returns their ids.
   */
  function starts(): number[] {
    try {
      return readFileSync(startLog, 'utf8').trim().split('\n').filter(Boolean).map(Number);
    } catch {
      return [];
    }
  }

  /**
   * Reports whether a process still exists.
   * @param pid The process.
   * @returns Returns true while it does.
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
   * Waits for a condition.
   * @param condition The condition.
   */
  async function until(condition: () => boolean): Promise<void> {
    const deadline: number = Date.now() + 3_000;
    while (!condition() && Date.now() < deadline) {
      await new Promise<void>((resolve: () => void): void => void setTimeout(resolve, 10));
    }
    expect(condition()).toBe(true);
  }

  /**
   * Says the decoder can run.
   * @returns Returns the resolution.
   */
  function runnable(): DecoderResolution {
    return { available: true, spec: { command: process.execPath, args: [script] } };
  }

  /**
   * Decodes a little.
   * @param first The first byte.
   * @returns Returns the listing.
   */
  function decode(first: number = 0x90): Promise<CodeListing | null> {
    return decoders.decode(FORMAT, new Uint8Array([first]), 0);
  }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'decoders-'));
    startLog = join(directory, 'starts.log');
    script = join(directory, 'decoder.cjs');
    writeFileSync(script, stubDecoder(startLog));
    resolution = runnable;
    registry = new DecoderRegistry();
    const descriptor: DecoderDescriptor = {
      id: 'stub',
      displayName: 'Stub',
      priority: 1,
      formats: [FORMAT],
      resolve: (): DecoderResolution => resolution(),
    };
    registry.register(descriptor);
    decoders = new Decoders(registry);
  });

  afterEach(async () => {
    decoders.disposeAll();
    await until(() => starts().every((pid: number): boolean => !alive(pid)));
    rmSync(directory, { recursive: true, force: true });
  });

  it('startsNothing_forAFormatNothingDecodes', async () => {
    expect(await decoders.decode('wasm', new Uint8Array([1]), 0)).toBeNull();
    expect(await decoders.info('wasm')).toBeNull();
    expect(starts()).toEqual([]);
  });

  it('decodesThroughTheDecoderInTheSlot', async () => {
    expect(await decode()).toEqual(expect.objectContaining({ language: 'x64' }));
  });

  it('describesTheDecoder', async () => {
    expect((await decoders.info(FORMAT))?.formats).toEqual([FORMAT]);
  });

  it('keepsOneProcess_acrossRequests', async () => {
    await decode();
    await decode();

    expect(starts()).toHaveLength(1);
  });

  it('startsOneProcess_forConcurrentRequests', async () => {
    await Promise.all([decode(), decode(), decoders.info(FORMAT)]);

    expect(starts()).toHaveLength(1);
  });

  it('answersNull_forADecoderNotInstalled', async () => {
    resolution = (): DecoderResolution => ({ available: false, reason: 'not installed' });

    expect(await decode()).toBeNull();
    expect(decoders.isAvailable(FORMAT)).toBe(false);
  });

  it('startsADecoderInstalledAfterAFirstAttemptFoundNone', async () => {
    // 🔥 The panel's own flow: a binary opens, nothing is installed, the user takes the offer and
    // installs one. The first attempt left a settled null behind as the start "in flight", so the
    // decoder never ran until Studio restarted.
    resolution = (): DecoderResolution => ({ available: false, reason: 'not installed' });
    await decode();

    resolution = runnable;

    expect(await decode()).not.toBeNull();
  });

  it('answersNull_whenResolvingTheDecoderThrows_andRecovers', async () => {
    resolution = (): never => {
      throw new Error('the manifest vanished');
    };

    expect(await decode()).toBeNull();

    resolution = runnable;

    expect(await decode()).not.toBeNull();
  });

  it('retries_afterAProcessThatCouldNotStart', async () => {
    resolution = (): DecoderResolution => ({
      available: true,
      spec: { command: join(directory, 'no-such-binary'), args: [] },
    });

    expect(await decode()).toBeNull();

    resolution = runnable;

    expect(await decode()).not.toBeNull();
  });

  it('startsAgain_afterTheDecoderCrashed', async () => {
    // 🔥 The dead client stayed in the map, so every later decode in the session answered null.
    await decode();

    expect(await decode(0xff)).toBeNull();
    const [first]: number[] = starts();
    await until(() => !alive(first));

    expect(await decode()).not.toBeNull();
    expect(starts()).toHaveLength(2);
  });

  it('leavesNoProcess_whenDisposedWhileOneStarts', async () => {
    // 🔥 The start finished after the map was emptied and put its client back, where nothing would
    // ever stop it.
    writeFileSync(script, stubDecoder(startLog, 100));

    const starting: Promise<CodeListing | null> = decode();
    await until(() => starts().length === 1);
    decoders.disposeAll();

    expect(await starting).toBeNull();
    const [pid]: number[] = starts();
    await until(() => !alive(pid));
  });

  it('stopsEveryProcess_onDispose', async () => {
    await decode();
    const [pid]: number[] = starts();

    decoders.disposeAll();

    await until(() => !alive(pid));
  });

  it('startsAgain_afterDispose', async () => {
    await decode();
    decoders.disposeAll();

    expect(await decode()).not.toBeNull();
    expect(starts()).toHaveLength(2);
  });
});
