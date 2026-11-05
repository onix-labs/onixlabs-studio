import type { Hash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { ReadableStream } from 'node:stream/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let userData: string = '';

/**
 * The digest every file hash reports, for an install path past the checksum: the pinned digests are of
 * the real distributions, which a fixture cannot reproduce. Undefined leaves hashing real.
 */
let forcedDigest: string | undefined;

vi.mock('electron', () => ({
  app: { getPath: (): string => userData },
}));

vi.mock('node:crypto', async (importOriginal: () => Promise<typeof import('node:crypto')>) => {
  const real: typeof import('node:crypto') = await importOriginal();
  const createHash: (algorithm: string) => Hash = (algorithm: string): Hash => {
    const hash: Hash = real.createHash(algorithm);
    if (forcedDigest !== undefined) {
      const digest: string = forcedDigest;
      hash.digest = ((): string => digest) as unknown as Hash['digest'];
    }
    return hash;
  };
  const named: object = Object.assign({}, real, { createHash });
  return Object.assign({}, named, { default: named });
});

const {
  DOWNLOAD_STALL_MS,
  GOPLS_VERSION,
  JDTLS_SHA256,
  JDTLS_VERSION,
  KOTLIN_LS_SHA256,
  KOTLIN_LS_VERSION,
  LspProvisioner,
  ROSLYN_SHA512,
  ROSLYN_VERSION,
  roslynBinaryCandidates,
} = await import('./lsp-provisioner');
type Provisioner = InstanceType<typeof LspProvisioner>;

/**
 * The fields of a fetch response the provisioner reads.
 */
interface FakeResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly body: ReadableStream<Uint8Array> | null;
}

/**
 * Builds a successful response carrying some bytes.
 * @param bytes The body.
 * @returns Returns the response.
 */
function delivers(bytes: Uint8Array = new TextEncoder().encode('archive')): FakeResponse {
  return {
    ok: true,
    status: 200,
    body: new ReadableStream<Uint8Array>({
      start(controller: ReadableStreamDefaultController<Uint8Array>): void {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
  };
}

/**
 * Builds a response whose connection drops after the first chunk.
 * @returns Returns the response.
 */
function dropsMidway(): FakeResponse {
  return {
    ok: true,
    status: 200,
    body: new ReadableStream<Uint8Array>({
      pull(controller: ReadableStreamDefaultController<Uint8Array>): void {
        controller.enqueue(new TextEncoder().encode('part of an archive'));
        controller.error(new Error('connection reset'));
      },
    }),
  };
}

/**
 * Serves each fetch from a list of outcomes, the last repeating.
 * @param outcomes The responses, or errors to reject with.
 * @returns Returns the stub, for counting calls.
 */
function serve(...outcomes: (FakeResponse | Error)[]): ReturnType<typeof vi.fn> {
  let call: number = 0;
  const stub: ReturnType<typeof vi.fn> = vi.fn((): Promise<FakeResponse> => {
    const outcome: FakeResponse | Error | undefined = outcomes[Math.min(call, outcomes.length - 1)];
    call += 1;
    return outcome === undefined || outcome instanceof Error
      ? Promise.reject(outcome ?? new Error('nothing to serve'))
      : Promise.resolve(outcome);
  });
  vi.stubGlobal('fetch', stub);
  return stub;
}

describe.skipIf(process.platform === 'win32')('LspProvisioner installs', () => {
  const rid: string = `${process.platform === 'darwin' ? 'osx' : 'linux'}-${
    process.arch === 'arm64' ? 'arm64' : 'x64'
  }`;
  let scratch: string = '';
  let bin: string = '';
  let provisioner: Provisioner;

  beforeEach(() => {
    scratch = mkdtempSync(path.join(tmpdir(), 'studio-provisioner-'));
    userData = path.join(scratch, 'userData');
    bin = path.join(scratch, 'bin');
    mkdirSync(userData);
    mkdirSync(bin);
    forcedDigest = undefined;
    vi.stubEnv('PATH', `${bin}${path.delimiter}${process.env['PATH'] ?? ''}`);
    provisioner = new LspProvisioner();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    rmSync(scratch, { recursive: true, force: true });
  });

  /**
   * Puts a fake tool on the PATH.
   * @param name The executable's name.
   * @param body The shell script's body.
   */
  function tool(name: string, body: string): void {
    const file: string = path.join(bin, name);
    writeFileSync(file, `#!/bin/sh\necho "$@" >> "${file}.log"\n${body}\n`);
    chmodSync(file, 0o755);
  }

  /**
   * Counts the runs of a fake tool.
   * @param name The executable's name.
   * @returns Returns how many times it ran.
   */
  function runs(name: string): number {
    const log: string = path.join(bin, `${name}.log`);
    return existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').length : 0;
  }

  /**
   * Puts a fake `unzip` on the PATH that lays out files under its destination (`-q -o <zip> -d <dir>`).
   * @param files The files, relative to the destination.
   */
  function unzipCreates(...files: readonly string[]): void {
    const steps: string[] = files.flatMap((file: string): string[] => [
      `mkdir -p "$5/${path.dirname(file)}"`,
      `: > "$5/${file}"`,
    ]);
    tool('unzip', steps.join('\n'));
  }

  describe('Roslyn', () => {
    const roslynDir: () => string = (): string =>
      path.join(userData, 'lsp-servers', 'roslyn', ROSLYN_VERSION);
    const binary: () => string = (): string =>
      path.join(roslynDir(), roslynBinaryCandidates(rid, false)[0]);
    const extracted: string = path.join(
      'tools',
      'net10.0',
      rid,
      'Microsoft.CodeAnalysis.LanguageServer',
    );

    it('installs_verifiesExtractsAndMarksComplete_leavingAnExecutableAndNoArchive', async () => {
      forcedDigest = ROSLYN_SHA512[rid];
      unzipCreates(extracted);
      serve(delivers());

      const installed: string | null = await provisioner.ensureRoslyn();

      expect(installed).toBe(binary());
      expect(statSync(binary()).mode & 0o111).toBe(0o111);
      expect(existsSync(path.join(roslynDir(), rid, 'server.nupkg'))).toBe(false);
      expect(provisioner.isProvisioned('roslyn', ROSLYN_VERSION)).toBe(true);
    });

    it('sharesOneDownload_betweenConcurrentCallers', async () => {
      forcedDigest = ROSLYN_SHA512[rid];
      unzipCreates(extracted);
      const fetched: ReturnType<typeof vi.fn> = serve(delivers());

      const results: (string | null)[] = await Promise.all([
        provisioner.ensureRoslyn(),
        provisioner.ensureRoslyn(),
        provisioner.ensureRoslyn(),
      ]);

      expect(results).toEqual([binary(), binary(), binary()]);
      expect(fetched).toHaveBeenCalledTimes(1);
      expect(runs('unzip')).toBe(1);
    });

    it('anInstallThatPredatesTheMarker_isReused_andMarked_withoutDownloading', async () => {
      mkdirSync(path.dirname(binary()), { recursive: true });
      writeFileSync(binary(), '');
      const fetched: ReturnType<typeof vi.fn> = serve(new Error('must not download'));

      expect(await provisioner.ensureRoslyn()).toBe(binary());

      expect(fetched).not.toHaveBeenCalled();
      expect(provisioner.isProvisioned('roslyn', ROSLYN_VERSION)).toBe(true);
    });

    describe('a download that stops moving', () => {
      afterEach(() => {
        vi.useRealTimers();
      });

      /**
       * Serves a response from a source the test feeds by hand, which aborts as a real fetch would.
       * @param body The body, or null for a server that never answers.
       * @returns Returns the stub.
       */
      function hangs(body: ReadableStream<Uint8Array> | null): ReturnType<typeof vi.fn> {
        const stub: ReturnType<typeof vi.fn> = vi.fn(
          (_url: string, init?: RequestInit): Promise<FakeResponse> =>
            body === null
              ? new Promise<FakeResponse>(
                  (_resolve: unknown, reject: (reason: unknown) => void): void => {
                    init?.signal?.addEventListener('abort', (): void => {
                      reject(init.signal?.reason as Error);
                    });
                  },
                )
              : Promise.resolve({ ok: true, status: 200, body }),
        );
        vi.stubGlobal('fetch', stub);
        return stub;
      }

      it('aServerThatNeverAnswers_givesUp', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const fetched: ReturnType<typeof vi.fn> = hangs(null);

        const install: Promise<string | null> = provisioner.ensureRoslyn();
        await vi.waitFor(() => {
          expect(fetched).toHaveBeenCalled();
        });
        await vi.advanceTimersByTimeAsync(DOWNLOAD_STALL_MS + 1);

        expect(await install).toBeNull();
        expect(provisioner.isProvisioned('roslyn', ROSLYN_VERSION)).toBe(false);
      });

      it('aBodyThatStops_givesUp', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const fetched: ReturnType<typeof vi.fn> = hangs(
          new ReadableStream<Uint8Array>({
            start(controller: ReadableStreamDefaultController<Uint8Array>): void {
              controller.enqueue(new TextEncoder().encode('part of an archive'));
            },
          }),
        );

        const install: Promise<string | null> = provisioner.ensureRoslyn();
        await vi.waitFor(() => {
          expect(fetched).toHaveBeenCalled();
        });
        await vi.advanceTimersByTimeAsync(DOWNLOAD_STALL_MS + 1);

        expect(await install).toBeNull();
      });

      it('aSlowBodyThatKeepsMoving_isLetFinish', async () => {
        forcedDigest = ROSLYN_SHA512[rid];
        unzipCreates(extracted);
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        let source: ReadableStreamDefaultController<Uint8Array> | null = null;
        const fetched: ReturnType<typeof vi.fn> = hangs(
          new ReadableStream<Uint8Array>({
            start(controller: ReadableStreamDefaultController<Uint8Array>): void {
              source = controller;
            },
          }),
        );

        const install: Promise<string | null> = provisioner.ensureRoslyn();
        await vi.waitFor(() => {
          expect(fetched).toHaveBeenCalled();
        });
        for (let chunk: number = 0; chunk < 4; chunk += 1) {
          (source as unknown as ReadableStreamDefaultController<Uint8Array>).enqueue(
            new TextEncoder().encode('more'),
          );
          await new Promise<void>((resolve: () => void): void => {
            setImmediate(resolve);
          });
          await new Promise<void>((resolve: () => void): void => {
            setImmediate(resolve);
          });
          await vi.advanceTimersByTimeAsync(DOWNLOAD_STALL_MS * 0.75);
        }
        (source as unknown as ReadableStreamDefaultController<Uint8Array>).close();

        expect(await install).toBe(binary());
      });
    });

    it('aNetworkFailure_isNull_andNotRemembered_soARetryDownloadsAgain', async () => {
      forcedDigest = ROSLYN_SHA512[rid];
      unzipCreates(extracted);
      serve(new Error('getaddrinfo ENOTFOUND'), delivers());

      expect(await provisioner.ensureRoslyn()).toBeNull();
      expect(provisioner.isProvisioned('roslyn', ROSLYN_VERSION)).toBe(false);

      expect(await provisioner.ensureRoslyn()).toBe(binary());
    });

    it.each<[string, FakeResponse]>([
      ['aServerError', { ok: false, status: 503, body: null }],
      ['aSuccessWithNoBody', { ok: true, status: 200, body: null }],
    ])('%s_isNull_andExtractsNothing', async (_name: string, response: FakeResponse) => {
      unzipCreates(extracted);
      serve(response);

      expect(await provisioner.ensureRoslyn()).toBeNull();

      expect(runs('unzip')).toBe(0);
      expect(provisioner.isProvisioned('roslyn', ROSLYN_VERSION)).toBe(false);
    });

    it('aConnectionDroppedMidDownload_isNull_andARetryReplacesThePartialFile', async () => {
      forcedDigest = ROSLYN_SHA512[rid];
      unzipCreates(extracted);
      serve(dropsMidway(), delivers());

      expect(await provisioner.ensureRoslyn()).toBeNull();
      expect(runs('unzip')).toBe(0);

      expect(await provisioner.ensureRoslyn()).toBe(binary());
    });

    it('aChecksumMismatch_neverExtracts_andRemovesTheWholeVersion', async () => {
      // The digest is real here: the fixture's bytes are not the pinned package.
      unzipCreates(extracted);
      serve(delivers());

      expect(await provisioner.ensureRoslyn()).toBeNull();

      expect(runs('unzip')).toBe(0);
      expect(path.relative(userData, roslynDir()).startsWith('..')).toBe(false);
      expect(existsSync(roslynDir())).toBe(false);
    });

    it('anExtractorFailure_isNull_andLeavesNoMarker', async () => {
      forcedDigest = ROSLYN_SHA512[rid];
      tool('unzip', 'echo "End-of-central-directory signature not found" >&2\nexit 9');
      serve(delivers());

      expect(await provisioner.ensureRoslyn()).toBeNull();

      expect(provisioner.isProvisioned('roslyn', ROSLYN_VERSION)).toBe(false);
      expect(provisioner.installedRoslyn()).toBeNull();
    });

    it('aPackageWithoutTheServer_isNull_andLeavesNoMarker', async () => {
      forcedDigest = ROSLYN_SHA512[rid];
      unzipCreates('README.md');
      serve(delivers());

      expect(await provisioner.ensureRoslyn()).toBeNull();

      expect(provisioner.isProvisioned('roslyn', ROSLYN_VERSION)).toBe(false);
    });

    it('pruneRoslyn_keepsOnlyThePinnedVersion', async () => {
      forcedDigest = ROSLYN_SHA512[rid];
      unzipCreates(extracted);
      serve(delivers());
      await provisioner.ensureRoslyn();
      const older: string = path.join(path.dirname(roslynDir()), '5.4.0-2.26179.14');
      mkdirSync(older);
      expect(path.relative(scratch, older).startsWith('..')).toBe(false);

      await provisioner.pruneRoslyn();

      expect(readdirSync(path.dirname(roslynDir()))).toEqual([ROSLYN_VERSION]);
    });
  });

  describe('JDT.LS', () => {
    const jdtlsDir: () => string = (): string =>
      path.join(userData, 'lsp-servers', 'jdtls', JDTLS_VERSION);
    const configDir: string = `config_${
      process.platform === 'darwin' ? 'mac' : 'linux'
    }${process.arch === 'arm64' ? '_arm' : ''}`;
    const launcherName: string = 'org.eclipse.equinox.launcher_1.7.0.jar';

    /**
     * Builds a real gzipped tar of the named files.
     * @param files The files in the archive.
     * @returns Returns the archive's bytes.
     */
    function tarball(...files: readonly string[]): Uint8Array {
      const content: string = path.join(scratch, 'tarball');
      for (const file of files) {
        mkdirSync(path.dirname(path.join(content, file)), { recursive: true });
        writeFileSync(path.join(content, file), 'x');
      }
      const archive: string = path.join(scratch, 'fixture.tar.gz');
      execFileSync('tar', ['-czf', archive, '-C', content, '.']);
      return readFileSync(archive);
    }

    const complete: () => Uint8Array = (): Uint8Array =>
      tarball(path.join('plugins', launcherName), path.join(configDir, 'config.ini'));

    it('installsFromARealArchive_andFindsTheLauncherAndConfig', async () => {
      forcedDigest = JDTLS_SHA256;
      serve(delivers(complete()));

      const install: unknown = await provisioner.ensureJdtls();

      expect(install).toEqual({
        launcherJar: path.join(jdtlsDir(), 'plugins', launcherName),
        configDir: path.join(jdtlsDir(), configDir),
      });
      expect(existsSync(path.join(jdtlsDir(), 'jdtls.tar.gz'))).toBe(false);
      expect(provisioner.isProvisioned('jdtls', JDTLS_VERSION)).toBe(true);
    });

    it('aTruncatedArchive_isNull_andLeavesNoMarker', async () => {
      forcedDigest = JDTLS_SHA256;
      const whole: Uint8Array = complete();
      serve(delivers(whole.slice(0, Math.floor(whole.length / 2))));

      expect(await provisioner.ensureJdtls()).toBeNull();

      expect(provisioner.isProvisioned('jdtls', JDTLS_VERSION)).toBe(false);
    });

    it('anArchiveWithoutThisPlatformsConfig_isNull_andLeavesNoMarker', async () => {
      forcedDigest = JDTLS_SHA256;
      serve(delivers(tarball(path.join('plugins', launcherName))));

      expect(await provisioner.ensureJdtls()).toBeNull();

      // A marked install is reported as ready by the Plugin Manager, and fails at the point of use.
      expect(provisioner.isProvisioned('jdtls', JDTLS_VERSION)).toBe(false);
    });

    it('aChecksumMismatch_removesTheArchive_andNeverExtracts', async () => {
      tool('tar', 'exit 0');
      serve(delivers());

      expect(await provisioner.ensureJdtls()).toBeNull();

      expect(runs('tar')).toBe(0);
      expect(existsSync(path.join(jdtlsDir(), 'jdtls.tar.gz'))).toBe(false);
    });

    it('aFailedDownload_isNotRemembered_soAnotherInstallAttemptDownloadsAgain', async () => {
      forcedDigest = JDTLS_SHA256;
      serve(new Error('getaddrinfo ENOTFOUND'), delivers(complete()));

      expect(await provisioner.ensureJdtls()).toBeNull();

      expect(await provisioner.ensureJdtls()).not.toBeNull();
    });

    it('sharesOneDownload_betweenConcurrentCallers', async () => {
      forcedDigest = JDTLS_SHA256;
      const fetched: ReturnType<typeof vi.fn> = serve(delivers(complete()));

      const results: unknown[] = await Promise.all([
        provisioner.ensureJdtls(),
        provisioner.ensureJdtls(),
      ]);

      expect(results[0]).toEqual(results[1]);
      expect(fetched).toHaveBeenCalledTimes(1);
    });

    it('reusesAnExistingInstall_withoutDownloading', async () => {
      mkdirSync(path.join(jdtlsDir(), 'plugins'), { recursive: true });
      mkdirSync(path.join(jdtlsDir(), configDir));
      writeFileSync(path.join(jdtlsDir(), 'plugins', launcherName), '');
      const fetched: ReturnType<typeof vi.fn> = serve(new Error('must not download'));

      expect(await provisioner.ensureJdtls()).not.toBeNull();

      expect(fetched).not.toHaveBeenCalled();
      expect(provisioner.isProvisioned('jdtls', JDTLS_VERSION)).toBe(true);
    });
  });

  describe('Kotlin', () => {
    const launcher: () => string = (): string =>
      path.join(
        userData,
        'lsp-servers',
        'kotlin',
        KOTLIN_LS_VERSION,
        'server',
        'bin',
        'kotlin-language-server',
      );

    it('installs_withAnExecutableLauncher', async () => {
      forcedDigest = KOTLIN_LS_SHA256;
      unzipCreates(path.join('server', 'bin', 'kotlin-language-server'));
      serve(delivers());

      expect(await provisioner.ensureKotlin()).toBe(launcher());

      expect(statSync(launcher()).mode & 0o111).toBe(0o111);
      expect(provisioner.isProvisioned('kotlin', KOTLIN_LS_VERSION)).toBe(true);
    });

    it('aChecksumMismatch_neverExtracts', async () => {
      unzipCreates(path.join('server', 'bin', 'kotlin-language-server'));
      serve(delivers());

      expect(await provisioner.ensureKotlin()).toBeNull();

      expect(runs('unzip')).toBe(0);
    });

    it('anArchiveWithoutTheLauncher_isNull_andLeavesNoMarker', async () => {
      forcedDigest = KOTLIN_LS_SHA256;
      unzipCreates('README.md');
      serve(delivers());

      expect(await provisioner.ensureKotlin()).toBeNull();

      expect(provisioner.isProvisioned('kotlin', KOTLIN_LS_VERSION)).toBe(false);
    });

    it('aFailedDownload_isNotRemembered', async () => {
      forcedDigest = KOTLIN_LS_SHA256;
      unzipCreates(path.join('server', 'bin', 'kotlin-language-server'));
      serve({ ok: false, status: 502, body: null }, delivers());

      expect(await provisioner.ensureKotlin()).toBeNull();

      expect(await provisioner.ensureKotlin()).toBe(launcher());
    });

    it('reusesALauncherAlreadyThere_withoutDownloading', async () => {
      mkdirSync(path.dirname(launcher()), { recursive: true });
      writeFileSync(launcher(), '');
      const fetched: ReturnType<typeof vi.fn> = serve(new Error('must not download'));

      expect(await provisioner.ensureKotlin()).toBe(launcher());

      expect(fetched).not.toHaveBeenCalled();
    });
  });

  describe('gopls', () => {
    const goplsDir: () => string = (): string =>
      path.join(userData, 'lsp-servers', 'gopls', GOPLS_VERSION);

    it('buildsIntoAPrivateGobinAndGopath_notTheUsersOwn', async () => {
      vi.stubEnv('GOPATH', '/the/users/gopath');
      const go: string = path.join(bin, 'go');
      tool('go', 'echo "$GOPATH $GOCACHE" > "$GOBIN/gopls"');

      expect(await provisioner.ensureGopls(go)).toBe(path.join(goplsDir(), 'gopls'));

      const cache: string = path.join(userData, 'lsp-servers', 'go');
      expect(readFileSync(path.join(goplsDir(), 'gopls'), 'utf8').trim()).toBe(
        `${cache} ${path.join(cache, 'cache')}`,
      );
      expect(provisioner.isProvisioned('gopls', GOPLS_VERSION)).toBe(true);
    });

    it('aFailedBuild_isNull_leavesNoMarker_andIsNotRemembered', async () => {
      const go: string = path.join(bin, 'go');
      tool('go', 'echo "build failed" >&2\nexit 1');

      expect(await provisioner.ensureGopls(go)).toBeNull();
      expect(provisioner.isProvisioned('gopls', GOPLS_VERSION)).toBe(false);

      tool('go', ': > "$GOBIN/gopls"');
      expect(await provisioner.ensureGopls(go)).toBe(path.join(goplsDir(), 'gopls'));
    });

    it('aBuildThatProducesNothing_isNull_andLeavesNoMarker', async () => {
      const go: string = path.join(bin, 'go');
      tool('go', 'exit 0');

      expect(await provisioner.ensureGopls(go)).toBeNull();

      expect(provisioner.isProvisioned('gopls', GOPLS_VERSION)).toBe(false);
    });

    it('aGoThatCannotRun_isNull', async () => {
      expect(await provisioner.ensureGopls(path.join(bin, 'no-such-go'))).toBeNull();
    });

    it('removeGoBuildCache_clearsAReadOnlyModuleCache', async () => {
      // Go writes its module cache read-only, directories included.
      const cache: string = path.join(userData, 'lsp-servers', 'go');
      const moduleDir: string = path.join(cache, 'pkg', 'mod', 'golang.org', 'x@v1.0.0');
      mkdirSync(moduleDir, { recursive: true });
      writeFileSync(path.join(moduleDir, 'go.mod'), 'module x');
      chmodSync(moduleDir, 0o555);
      expect(path.relative(scratch, cache).startsWith('..')).toBe(false);

      await provisioner.removeGoBuildCache();

      expect(existsSync(cache)).toBe(false);
    });

    it('removeGoBuildCache_isQuiet_whenThereIsNone', async () => {
      await expect(provisioner.removeGoBuildCache()).resolves.toBeUndefined();
    });
  });

  describe('install directories', () => {
    it('dataDirectory_keepsWorkspacesSharingAPrefixApart_andIsStable', async () => {
      const first: string = await provisioner.dataDirectory('jdtls', '/Users/me/Development/alpha');
      const second: string = await provisioner.dataDirectory('jdtls', '/Users/me/Development/beta');

      expect(first).not.toBe(second);
      expect(await provisioner.dataDirectory('jdtls', '/Users/me/Development/alpha')).toBe(first);
      expect(statSync(first).isDirectory()).toBe(true);
      expect(path.relative(userData, first).startsWith('..')).toBe(false);
    });

    it('isProvisioned_isFalseForADirectoryLeftByAnInterruptedInstall', () => {
      mkdirSync(path.join(userData, 'lsp-servers', 'gopls', GOPLS_VERSION), { recursive: true });

      expect(provisioner.isProvisioned('gopls', GOPLS_VERSION)).toBe(false);
    });

    it('removeProvisioned_removesTheInstall_andIsQuietWhenItIsGone', async () => {
      const install: string = path.join(userData, 'lsp-servers', 'gopls', GOPLS_VERSION);
      mkdirSync(install, { recursive: true });
      expect(path.relative(scratch, install).startsWith('..')).toBe(false);

      await provisioner.removeProvisioned('gopls', GOPLS_VERSION);
      await provisioner.removeProvisioned('gopls', GOPLS_VERSION);

      expect(existsSync(install)).toBe(false);
    });
  });

  describe('runtime detection', () => {
    beforeEach(() => {
      // Only the fakes: whatever this machine has installed must not decide these.
      vi.stubEnv('PATH', bin);
      vi.stubEnv('JAVA_HOME', '');
      vi.stubEnv('DOTNET_ROOT', '');
      vi.stubEnv('GOROOT', '');
    });

    /**
     * Writes a fake `java` reporting a version.
     * @param where The directory.
     * @param version The version it reports.
     * @returns Returns its path.
     */
    function java(where: string, version: string): string {
      mkdirSync(where, { recursive: true });
      const file: string = path.join(where, 'java');
      writeFileSync(file, `#!/bin/sh\necho 'openjdk version "${version}" 2026-01-01' >&2\n`);
      chmodSync(file, 0o755);
      return file;
    }

    it('detectJava_prefersAnAdequateOverride', async () => {
      java(bin, '21.0.8');
      const override: string = java(path.join(scratch, 'override'), '25.0.1');

      expect(await provisioner.detectJava(override)).toBe(override);
    });

    it('detectJava_skipsAnOverrideThatIsTooOld_forJavaHome_thenThePath', async () => {
      const old: string = java(path.join(scratch, 'old'), '17.0.2');
      const home: string = path.join(scratch, 'home');
      const fromHome: string = java(path.join(home, 'bin'), '21.0.1');
      vi.stubEnv('JAVA_HOME', home);

      expect(await provisioner.detectJava(old)).toBe(fromHome);
    });

    it('detectJava_readsTheRealMajorOfALegacyVersion', async () => {
      java(bin, '1.8.0_392');

      expect(await provisioner.detectJava(null)).toBeNull();
    });

    it('detectJava_isNull_forOutputItCannotRead_orNoJavaAtAll', async () => {
      tool('java', 'echo "command not found: sdkman shim" >&2');

      expect(await provisioner.detectJava(null)).toBeNull();
      expect(await new LspProvisioner().detectJava(path.join(bin, 'no-such'))).toBeNull();
    });

    it('detectJava_probesOncePerSession', async () => {
      tool('java', `echo 'openjdk version "21.0.8"' >&2`);

      await Promise.all([provisioner.detectJava(null), provisioner.detectJava(null)]);

      expect(runs('java')).toBe(1);
    });

    it('detectDotnet_wantsAnSdkOfTheMinimumMajor_notJustARuntime', async () => {
      const old: string = path.join(scratch, 'old');
      mkdirSync(old);
      writeFileSync(
        path.join(old, 'dotnet'),
        '#!/bin/sh\necho "8.0.100 [/sdk]"\necho "9.0.203 [/sdk]"\n',
      );
      chmodSync(path.join(old, 'dotnet'), 0o755);
      tool('dotnet', 'echo "6.0.1 [/sdk]"\necho "10.0.100 [/sdk]"');

      expect(await provisioner.detectDotnet(path.join(old, 'dotnet'))).toBe('dotnet');
    });

    it('detectDotnet_usesDotnetRoot_beforeThePath', async () => {
      const root: string = path.join(scratch, 'root');
      mkdirSync(root);
      writeFileSync(path.join(root, 'dotnet'), '#!/bin/sh\necho "10.0.100 [/sdk]"\n');
      chmodSync(path.join(root, 'dotnet'), 0o755);
      vi.stubEnv('DOTNET_ROOT', root);

      expect(await provisioner.detectDotnet(null)).toBe(path.join(root, 'dotnet'));
    });

    it('detectGo_acceptsOnlyAnExecutableThatIdentifiesItselfAsGo', async () => {
      const impostor: string = path.join(bin, 'impostor');
      writeFileSync(impostor, '#!/bin/sh\necho "version 1"\n');
      chmodSync(impostor, 0o755);
      tool('go', 'echo "go version go1.24.0 darwin/arm64"');

      expect(await provisioner.detectGo(impostor)).toBe('go');
    });

    it('detectClangd_acceptsOnlyAnExecutableThatIdentifiesItselfAsClangd', async () => {
      const impostor: string = path.join(bin, 'impostor');
      writeFileSync(impostor, '#!/bin/sh\necho "gcc 14"\n');
      chmodSync(impostor, 0o755);
      tool('clangd', 'echo "Apple clangd version 17.0.0"');

      expect(await provisioner.detectClangd(impostor)).toBe('clangd');
    });

    it('detectExecutable_triesTheOverrideFirst_cachesPerBinary_andIsNullWhenNothingRuns', async () => {
      tool('ruff', 'exit 0');

      expect(await provisioner.detectExecutable('ruff', path.join(bin, 'gone'))).toBe('ruff');
      expect(await provisioner.detectExecutable('ruff', path.join(bin, 'gone'))).toBe('ruff');
      expect(await provisioner.detectExecutable('ty')).toBeNull();

      expect(runs('ruff')).toBe(1);
    });
  });
});
