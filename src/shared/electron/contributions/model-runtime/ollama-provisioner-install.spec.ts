import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { RuntimeInstallation, RuntimeInstallProgress } from '@shared/api/model-runtime-types';
import { OllamaAsset } from './ollama-assets';
import { DOWNLOAD_STALL_MS, OllamaProvisioner } from './ollama-provisioner';

/**
 * Runs a command, for building fixture archives.
 */
const run: (file: string, args: readonly string[]) => Promise<unknown> = promisify(execFile);

/**
 * A script standing in for the runtime, answering the version probe.
 */
const FAKE_RUNTIME: string = '#!/bin/sh\necho "ollama version is 1.2.3"\n';

/**
 * What the managed install answers when nothing is installed.
 */
const ABSENT: RuntimeInstallation = { kind: 'absent', executable: '', version: '' };

/**
 * A scratch directory for each test.
 */
let scratch: string = '';

/**
 * The stand-in for the network, which refuses unless a test says otherwise.
 */
let network: Mock<(url: string, init: RequestInit) => Promise<Response> | Response>;

beforeEach(async (): Promise<void> => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'ollama-install-'));
  network = vi.fn((): Promise<Response> | Response => Promise.reject(new Error('offline')));
  // ⛔ Replaced for every test, so a path this spec got wrong fails rather than reaching the release
  // server.
  vi.stubGlobal('fetch', network);
});

afterEach(async (): Promise<void> => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await fs.rm(scratch, { recursive: true, force: true });
});

/**
 * Packs files into a gzipped tarball.
 * @param files The files, by relative path.
 * @returns Returns the archive's bytes.
 */
async function tarball(files: Readonly<Record<string, string | Buffer>>): Promise<Buffer> {
  const source: string = await fs.mkdtemp(path.join(scratch, 'source-'));
  for (const [name, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(source, name)), { recursive: true });
    await fs.writeFile(path.join(source, name), content);
  }
  const archive: string = path.join(scratch, `${path.basename(source)}.tgz`);
  await run('tar', ['-czf', archive, '-C', source, '.']);
  return fs.readFile(archive);
}

/**
 * Describes an archive the way a pinned release does.
 * @param bytes The archive.
 * @returns Returns the asset.
 */
function assetOf(bytes: Buffer): OllamaAsset {
  return {
    name: 'ollama-fixture.tgz',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    archive: 'tgz',
  };
}

/**
 * Builds a provisioner over the scratch directory.
 * @param asset The asset to install, or null when this platform has none.
 * @returns Returns the provisioner.
 */
function provisionerFor(asset: OllamaAsset | null): OllamaProvisioner {
  return new OllamaProvisioner(
    path.join(scratch, 'root'),
    'linux',
    'x64',
    { PATH: path.join(scratch, 'empty') },
    [],
    (): OllamaAsset | null => asset,
  );
}

/**
 * Lets the network serve some bytes.
 * @param bytes The body.
 */
function serve(bytes: Buffer): void {
  network.mockImplementation((): Response => {
    const headers: Record<string, string> = { 'content-length': String(bytes.byteLength) };
    return new Response(new Uint8Array(bytes), { headers });
  });
}

/**
 * Collects what an install reports.
 * @returns Returns the list, and the listener that fills it.
 */
function progress(): {
  readonly seen: RuntimeInstallProgress[];
  readonly listen: (update: RuntimeInstallProgress) => void;
} {
  const seen: RuntimeInstallProgress[] = [];
  return { seen, listen: (update: RuntimeInstallProgress): void => void seen.push(update) };
}

/**
 * Lets real I/O run until a condition holds. Not `vi.waitFor`, which moves fake timers along by itself
 * and so spends the very stall window a test is measuring.
 * @param condition The condition.
 */
async function settledTo(condition: () => boolean): Promise<void> {
  for (let turn: number = 0; turn < 100_000 && !condition(); turn += 1) {
    await new Promise<void>((resolve: () => void): void => void setImmediate(resolve));
  }
  expect(condition()).toBe(true);
}

describe('OllamaProvisioner.install', () => {
  it('installsAWholeRuntime_andSaysSoAtEachStage', async () => {
    const bytes: Buffer = await tarball({ ollama: FAKE_RUNTIME });
    serve(bytes);
    const provisioner: OllamaProvisioner = provisionerFor(assetOf(bytes));
    const { seen, listen } = progress();

    const installed: RuntimeInstallation = await provisioner.install(listen);

    expect(installed).toEqual({
      kind: 'managed',
      executable: provisioner.managedExecutable(),
      version: '1.2.3',
    });
    expect(statSync(provisioner.managedExecutable()).mode & 0o111).toBe(0o111);
    expect(seen.map((update: RuntimeInstallProgress): string => update.stage)).toEqual(
      expect.arrayContaining(['downloading', 'verifying', 'extracting', 'done']),
    );
    expect(seen.find((update) => update.stage === 'downloading')?.total).toBe(bytes.byteLength);
  });

  it('keepsTheDirectoryAroundTheBinary_andNoArchiveOrStagingBesideIt', async () => {
    const bytes: Buffer = await tarball({ ollama: FAKE_RUNTIME, 'lib/runner.so': 'library' });
    serve(bytes);
    const provisioner: OllamaProvisioner = provisionerFor(assetOf(bytes));

    await provisioner.install();

    const installDir: string = path.dirname(provisioner.managedExecutable());
    expect((await fs.readdir(installDir)).sort()).toEqual(['lib', 'ollama']);
    expect(await fs.readdir(path.dirname(installDir))).toEqual([path.basename(installDir)]);
  });

  it('findsABinaryTheArchiveKeepsDeeper', async () => {
    const bytes: Buffer = await tarball({ 'bin/nested/ollama': FAKE_RUNTIME });
    serve(bytes);
    const provisioner: OllamaProvisioner = provisionerFor(assetOf(bytes));

    expect((await provisioner.install()).version).toBe('1.2.3');
    expect(existsSync(provisioner.managedExecutable())).toBe(true);
  });

  it('downloadsOnce_forConcurrentCallers', async () => {
    const bytes: Buffer = await tarball({ ollama: FAKE_RUNTIME });
    serve(bytes);
    const provisioner: OllamaProvisioner = provisionerFor(assetOf(bytes));

    await Promise.all([provisioner.install(), provisioner.install()]);

    expect(network).toHaveBeenCalledTimes(1);
  });

  it('reportsFailure_onAPlatformWithNoRelease', async () => {
    const { seen, listen } = progress();

    expect(await provisionerFor(null).install(listen)).toEqual(ABSENT);

    expect(seen.at(-1)?.stage).toBe('failed');
    expect(seen.at(-1)?.error).toContain('linux-x64');
    expect(network).not.toHaveBeenCalled();
  });

  describe('when it fails', () => {
    /**
     * Installs, expecting failure, and says what the user was told.
     * @param provisioner The provisioner.
     * @returns Returns the error reported.
     */
    async function failure(provisioner: OllamaProvisioner): Promise<string | undefined> {
      const { seen, listen } = progress();

      expect(await provisioner.install(listen)).toEqual(ABSENT);
      expect(seen.at(-1)?.stage).toBe('failed');

      return seen.at(-1)?.error;
    }

    /**
     * Asserts a failed install left nothing a later attempt, or detection, could mistake for a runtime.
     * @param provisioner The provisioner.
     */
    async function expectNothingLeft(provisioner: OllamaProvisioner): Promise<void> {
      expect(existsSync(provisioner.managedExecutable())).toBe(false);
      expect(await provisioner.detect()).toEqual(ABSENT);
      expect(existsSync(`${path.dirname(provisioner.managedExecutable())}.installing`)).toBe(false);
    }

    it('reportsAConnectionThatFailed', async () => {
      const provisioner: OllamaProvisioner = provisionerFor(assetOf(Buffer.from('x')));

      expect(await failure(provisioner)).toBe('offline');
      await expectNothingLeft(provisioner);
    });

    it('reportsAnHttpError', async () => {
      network.mockResolvedValue(new Response('gone', { status: 404 }));
      const provisioner: OllamaProvisioner = provisionerFor(assetOf(Buffer.from('x')));

      expect(await failure(provisioner)).toBe('download failed: 404');
      await expectNothingLeft(provisioner);
    });

    it('reportsAResponseWithNoBody', async () => {
      network.mockResolvedValue(new Response(null, { status: 200 }));
      const provisioner: OllamaProvisioner = provisionerFor(assetOf(Buffer.from('x')));

      expect(await failure(provisioner)).toBe('download failed: 200');
    });

    it('refusesAnArchiveThatFailsItsChecksum_beforeExtractingAnything', async () => {
      const bytes: Buffer = await tarball({ ollama: FAKE_RUNTIME });
      serve(bytes);
      const provisioner: OllamaProvisioner = provisionerFor({
        ...assetOf(bytes),
        sha256: '0'.repeat(64),
      });

      expect(await failure(provisioner)).toContain('checksum mismatch');
      await expectNothingLeft(provisioner);
    });

    it('reportsAnArchiveWithNoRuntimeInIt', async () => {
      const bytes: Buffer = await tarball({ 'README.md': 'no binary' });
      serve(bytes);
      const provisioner: OllamaProvisioner = provisionerFor(assetOf(bytes));

      expect(await failure(provisioner)).toContain('does not contain an ollama executable');
      await expectNothingLeft(provisioner);
    });

    it('leavesNoPartialBinary_fromAnExtractThatDiedPartWay', async () => {
      // 🔥 Cut off inside the binary, so tar has already written part of it when it fails. Left in
      // place, the retry saw a file at the managed path and "reused" a truncated runtime.
      const whole: Buffer = await tarball({ ollama: randomBytes(512 * 1024) });
      const truncated: Buffer = whole.subarray(0, whole.byteLength / 2);
      serve(truncated);
      const provisioner: OllamaProvisioner = provisionerFor(assetOf(truncated));

      await failure(provisioner);

      await expectNothingLeft(provisioner);
    });

    it('canBeRetried', async () => {
      const bytes: Buffer = await tarball({ ollama: FAKE_RUNTIME });
      const provisioner: OllamaProvisioner = provisionerFor(assetOf(bytes));

      await failure(provisioner);
      serve(bytes);

      expect((await provisioner.install()).kind).toBe('managed');
    });
  });

  it('clearsWhatAKilledInstallLeft', async () => {
    const bytes: Buffer = await tarball({ ollama: FAKE_RUNTIME });
    serve(bytes);
    const provisioner: OllamaProvisioner = provisionerFor(assetOf(bytes));
    const leftovers: string = `${path.dirname(provisioner.managedExecutable())}.installing`;
    await fs.mkdir(leftovers, { recursive: true });
    await fs.writeFile(path.join(leftovers, 'stale'), 'from a killed install');

    await provisioner.install();

    expect(existsSync(leftovers)).toBe(false);
    expect(existsSync(path.join(path.dirname(provisioner.managedExecutable()), 'stale'))).toBe(
      false,
    );
  });

  describe('a download that stops moving', () => {
    /**
     * Answers with a body the test feeds by hand, which never ends by itself.
     * @returns Returns how to feed it.
     */
    function trickle(): {
      readonly feed: (byte: number) => void;
      readonly finish: () => void;
    } {
      let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
      const body: ReadableStream<Uint8Array> = new ReadableStream<Uint8Array>({
        start: (opened: ReadableStreamDefaultController<Uint8Array>): void => {
          controller = opened;
        },
      });
      network.mockImplementation((_url: string, init: RequestInit): Response => {
        // As a real fetch does: aborting it errors the body it is still delivering.
        init.signal?.addEventListener('abort', (): void => controller?.error(init.signal?.reason));
        return new Response(body);
      });
      return {
        feed: (byte: number): void => controller?.enqueue(new Uint8Array([byte])),
        finish: (): void => controller?.close(),
      };
    }

    /**
     * Waits for the install to report a number of bytes.
     * @param seen The progress so far.
     * @param bytes The bytes to wait for.
     */
    async function received(seen: RuntimeInstallProgress[], bytes: number): Promise<void> {
      await settledTo((): boolean => seen.some((update) => update.received === bytes));
    }

    it('givesUp_whenTheServerNeverAnswers', async () => {
      // As a real fetch does: silent until it is aborted, then rejected.
      network.mockImplementation(
        (_url: string, init: RequestInit): Promise<Response> =>
          new Promise<Response>((_resolve, reject: (reason: Error) => void): void => {
            init.signal?.addEventListener('abort', (): void => reject(new Error('aborted')));
          }),
      );
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const provisioner: OllamaProvisioner = provisionerFor(assetOf(Buffer.from('x')));
      const { seen, listen } = progress();

      const installing: Promise<RuntimeInstallation> = provisioner.install(listen);
      await settledTo((): boolean => network.mock.calls.length > 0);
      await vi.advanceTimersByTimeAsync(DOWNLOAD_STALL_MS);

      expect(await installing).toEqual(ABSENT);
      expect(seen.at(-1)?.error).toContain('download stalled');
    });

    it('givesUp_whenTheBodyGoesQuiet_andCanBeRetried', async () => {
      const { feed } = trickle();
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const provisioner: OllamaProvisioner = provisionerFor(assetOf(Buffer.from('x')));
      const { seen, listen } = progress();

      const installing: Promise<RuntimeInstallation> = provisioner.install(listen);
      feed(1);
      await received(seen, 1);
      await vi.advanceTimersByTimeAsync(DOWNLOAD_STALL_MS);

      expect(await installing).toEqual(ABSENT);
      expect(seen.at(-1)?.error).toContain('download stalled');

      vi.useRealTimers();
      const bytes: Buffer = await tarball({ ollama: FAKE_RUNTIME });
      serve(bytes);
      expect((await provisionerFor(assetOf(bytes)).install()).kind).toBe('managed');
    });

    it('leavesASlowLinkThatKeepsMovingToFinish', async () => {
      const { feed, finish } = trickle();
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const asset: OllamaAsset = { ...assetOf(Buffer.from('x')), sha256: '0'.repeat(64) };
      const { seen, listen } = progress();

      const installing: Promise<RuntimeInstallation> = provisionerFor(asset).install(listen);
      for (const byte of [1, 2, 3]) {
        feed(byte);
        await received(seen, byte);
        await vi.advanceTimersByTimeAsync(DOWNLOAD_STALL_MS - 1);
      }
      finish();
      await installing;

      // Past three windows' worth of time and on to the checksum, so it was never called stalled.
      expect(seen.some((update) => update.stage === 'verifying')).toBe(true);
      expect(seen.at(-1)?.error).toContain('checksum mismatch');
    });
  });
});
