import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { platformKey } from './archive-provision';
import { isComplete } from './archive-provisioner';
import { LockfileProvision } from './lockfile-provision';
import { LockfileProvisioner } from './lockfile-provisioner';

const execFileAsync: (file: string, args: readonly string[]) => Promise<unknown> =
  promisify(execFile);

/**
 * The registry every stubbed fetch answers from: URL to bytes.
 */
let served: Map<string, Buffer>;

/**
 * The file a fixture package's lifecycle scripts would create if anything ever ran them.
 */
const SCRIPT_EVIDENCE: string = 'SCRIPT-RAN';

/**
 * Builds a real npm-shaped tarball — a gzipped tar rooted at `package/` — so extraction, the
 * `--strip-components` that undoes that root, and the integrity hash are all exercised against genuine
 * bytes rather than a mock that would agree with whatever the code did.
 * @param scratch A directory to build in.
 * @param name The package name, used for the file it contains.
 * @returns Returns the tarball's bytes.
 */
async function tarball(scratch: string, name: string): Promise<Buffer> {
  const staging: string = path.join(scratch, `stage-${name}`);
  mkdirSync(path.join(staging, 'package', 'bin'), { recursive: true });
  writeFileSync(path.join(staging, 'package', 'index.js'), `module.exports = '${name}';\n`);
  writeFileSync(path.join(staging, 'package', 'bin', 'run'), `#!/usr/bin/env node\n`);
  // Every fixture package declares a lifecycle script that would leave evidence if it ever ran. An
  // installer that grew the ability to run one would be caught by the test that looks for it.
  writeFileSync(
    path.join(staging, 'package', 'package.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      scripts: {
        preinstall: `node -e "require('fs').writeFileSync('${SCRIPT_EVIDENCE}','ran')"`,
        postinstall: `node -e "require('fs').writeFileSync('${SCRIPT_EVIDENCE}','ran')"`,
      },
    }),
  );
  const file: string = path.join(scratch, `${name}.tgz`);
  await execFileAsync('tar', ['-czf', file, '-C', staging, 'package']);
  return readFileSync(file);
}

/**
 * Computes a payload's Subresource Integrity string, the form a lockfile pins.
 * @param bytes The payload.
 * @returns Returns the integrity string.
 */
function integrity(bytes: Buffer): string {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}

/**
 * Computes a payload's lower-case hex SHA-256, the form a manifest pins a lockfile with.
 * @param bytes The payload.
 * @returns Returns the digest.
 */
function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('LockfileProvisioner', () => {
  let root: string;
  let scratch: string;
  let provisioner: LockfileProvisioner;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'studio-lockfile-'));
    scratch = mkdtempSync(path.join(tmpdir(), 'studio-lockfile-src-'));
    provisioner = new LockfileProvisioner(root, 'Test');
    served = new Map<string, Buffer>();
    vi.stubGlobal('fetch', (url: string): Promise<Response> => {
      const bytes: Buffer | undefined = served.get(url);
      return Promise.resolve(
        bytes === undefined
          ? new Response(null, { status: 404 })
          : new Response(new Uint8Array(bytes)),
      );
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(root, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  });

  /**
   * Serves a two-package tree — one nested, so the non-flat case is covered — and returns the
   * provision that installs it.
   * @param corrupt Optionally rewrites the lockfile document before it is served, to simulate a
   * registry that returns different bytes than were pinned.
   * @returns Returns the provision.
   */
  async function tree(
    corrupt: (document: Record<string, unknown>) => void = (): void => undefined,
  ): Promise<LockfileProvision> {
    const outer: Buffer = await tarball(scratch, 'outer');
    const inner: Buffer = await tarball(scratch, 'inner');
    served.set('https://registry.invalid/outer.tgz', outer);
    served.set('https://registry.invalid/inner.tgz', inner);
    const document: Record<string, unknown> = {
      name: 'demo',
      lockfileVersion: 3,
      packages: {
        '': { name: 'demo' },
        'node_modules/outer': {
          version: '1.0.0',
          resolved: 'https://registry.invalid/outer.tgz',
          integrity: integrity(outer),
        },
        'node_modules/outer/node_modules/inner': {
          version: '2.0.0',
          resolved: 'https://registry.invalid/inner.tgz',
          integrity: integrity(inner),
        },
      },
    };
    corrupt(document);
    const lockfile: Buffer = Buffer.from(JSON.stringify(document), 'utf8');
    served.set('https://example.invalid/demo.lock.json', lockfile);
    return {
      id: 'demo',
      version: '1.0.0',
      lockfileUrl: 'https://example.invalid/demo.lock.json',
      sha256: sha256(lockfile),
      executablePath: 'node_modules/outer/bin/run',
    };
  }

  it('directoryOf_scopesTheInstallByIdVersionAndPlatform', async () => {
    expect(provisioner.directoryOf(await tree())).toBe(
      path.join(root, 'demo', '1.0.0', platformKey()),
    );
  });

  it('isInstalled_freshRoot_isFalse', async () => {
    expect(provisioner.isInstalled(await tree())).toBe(false);
  });

  it('ensure_installsEveryPackageToThePathTheLockfileNames', async () => {
    const provision: LockfileProvision = await tree();
    const target: string | null = await provisioner.ensure(provision);
    const directory: string = path.join(root, 'demo', '1.0.0', platformKey());

    expect(target).toBe(path.join(directory, 'node_modules/outer/bin/run'));
    expect(existsSync(path.join(directory, 'node_modules/outer/index.js'))).toBe(true);
    // The nested, non-hoisted package landed where the lockfile said rather than being flattened.
    expect(existsSync(path.join(directory, 'node_modules/outer/node_modules/inner/index.js'))).toBe(
      true,
    );
    expect(isComplete(directory)).toBe(true);
    expect(provisioner.isInstalled(provision)).toBe(true);
  });

  it('ensure_stripsTheTarballsPackageRoot', async () => {
    // npm tarballs are rooted at `package/` and the lockfile's paths assume it is gone. Leaving it
    // would put every file one directory deeper than anything expects.
    await provisioner.ensure(await tree());
    const directory: string = path.join(root, 'demo', '1.0.0', platformKey());

    expect(existsSync(path.join(directory, 'node_modules/outer/package'))).toBe(false);
  });

  it('ensure_neverRunsAnythingThePackageShips', async () => {
    // The guarantee is structural, not a flag: nothing in the install path executes package content,
    // so a `scripts` block in the installed tree is inert data. Both fixture packages declare a
    // pre- and postinstall that would leave this file behind, and the install must complete without
    // one appearing anywhere it could have been written.
    const provision: LockfileProvision = await tree();
    const directory: string = path.join(root, 'demo', '1.0.0', platformKey());

    expect(await provisioner.ensure(provision)).not.toBeNull();
    expect(isComplete(directory)).toBe(true);
    for (const where of [directory, path.join(directory, 'node_modules/outer'), root, scratch]) {
      expect(existsSync(path.join(where, SCRIPT_EVIDENCE))).toBe(false);
    }
    expect(existsSync(path.join(process.cwd(), SCRIPT_EVIDENCE))).toBe(false);
  });

  it('ensure_aTamperedPackageFailsTheWholeInstall', async () => {
    // The atomicity rule. A tree missing one package is not a smaller tree, it is a broken one, so a
    // single integrity mismatch must take the whole directory with it rather than report success.
    const provision: LockfileProvision = await tree((document: Record<string, unknown>): void => {
      const packages: Record<string, Record<string, unknown>> = document['packages'] as Record<
        string,
        Record<string, unknown>
      >;
      packages['node_modules/outer/node_modules/inner']['integrity'] = `sha512-${'a'.repeat(86)}==`;
    });

    expect(await provisioner.ensure(provision)).toBeNull();
    expect(existsSync(path.join(root, 'demo', '1.0.0', platformKey()))).toBe(false);
    expect(provisioner.isInstalled(provision)).toBe(false);
  });

  it('ensure_aTamperedLockfileIsRefusedBeforeAnythingIsFetched', async () => {
    const provision: LockfileProvision = await tree();
    const wrong: LockfileProvision = { ...provision, sha256: 'f'.repeat(64) };

    expect(await provisioner.ensure(wrong)).toBeNull();
    expect(existsSync(path.join(root, 'demo', '1.0.0', platformKey()))).toBe(false);
  });

  it('ensure_aLockfileThatCannotBeHonouredInstallsNothing', async () => {
    const provision: LockfileProvision = await tree((document: Record<string, unknown>): void => {
      document['lockfileVersion'] = 1;
    });

    expect(await provisioner.ensure(provision)).toBeNull();
    expect(existsSync(path.join(root, 'demo', '1.0.0', platformKey()))).toBe(false);
  });

  it('ensure_anEntryPointTheTreeDoesNotContainFails', async () => {
    // Every package verified, and still not a working install: the thing the caller asked for is not
    // there. Reporting success would fail later and further away.
    const provision: LockfileProvision = {
      ...(await tree()),
      executablePath: 'node_modules/outer/bin/absent',
    };

    expect(await provisioner.ensure(provision)).toBeNull();
    expect(existsSync(path.join(root, 'demo', '1.0.0', platformKey()))).toBe(false);
  });

  it('ensure_isCachedSoRacingCallersFetchOnce', async () => {
    const provision: LockfileProvision = await tree();
    const [first, second]: readonly (string | null)[] = await Promise.all([
      provisioner.ensure(provision),
      provisioner.ensure(provision),
    ]);

    expect(first).toBe(second);
    expect(first).not.toBeNull();
  });

  it('remove_takesTheTreeAndItsEmptyParentsWithIt', async () => {
    const provision: LockfileProvision = await tree();
    await provisioner.ensure(provision);
    await provisioner.remove(provision);

    expect(existsSync(path.join(root, 'demo', '1.0.0', platformKey()))).toBe(false);
    expect(existsSync(path.join(root, 'demo'))).toBe(false);
  });

  it('remove_thenEnsure_installsAgain', async () => {
    // Removing must clear the cached install too, or an uninstall followed by an install hands back a
    // path that is no longer there.
    const provision: LockfileProvision = await tree();
    await provisioner.ensure(provision);
    await provisioner.remove(provision);

    expect(await provisioner.ensure(provision)).not.toBeNull();
    expect(provisioner.isInstalled(provision)).toBe(true);
  });

  it('ensure_withProvisioningDisabled_installsNothing', async () => {
    const disabled: LockfileProvisioner = new LockfileProvisioner(null, 'Test');

    expect(await disabled.ensure(await tree())).toBeNull();
  });

  describe('with a lockfile compiled into the application', () => {
    /**
     * Builds a provisioner whose bundled lockfile is the served document, and a provision whose URL is
     * unreachable — which is the real situation while this repository is private, since
     * `raw.githubusercontent.com` does not serve one.
     * @returns Returns the provisioner and the provision.
     */
    async function bundledSetup(): Promise<{
      provisioner: LockfileProvisioner;
      provision: LockfileProvision;
    }> {
      const provision: LockfileProvision = await tree();
      const document: unknown = JSON.parse(served.get(provision.lockfileUrl)!.toString('utf8'));
      served.delete(provision.lockfileUrl);
      return {
        provisioner: new LockfileProvisioner(root, 'Test', (): unknown => document),
        provision,
      };
    }

    it('installsWithoutFetchingTheLockfileAtAll', async () => {
      const { provisioner: bundled, provision } = await bundledSetup();

      expect(await bundled.ensure(provision)).not.toBeNull();
      expect(bundled.isInstalled(provision)).toBe(true);
    });

    it('doesNotRequireThePinnedHashToMatch', async () => {
      // The pinned SHA-256 verifies a *download*. A document compiled into the application arrived in
      // the same bundle as the code reading it, so there is nothing for it to verify.
      const { provisioner: bundled, provision } = await bundledSetup();

      expect(await bundled.ensure({ ...provision, sha256: 'f'.repeat(64) })).not.toBeNull();
    });

    it('stillRefusesALockfileItCannotHonour', async () => {
      const provision: LockfileProvision = await tree();
      const bundled: LockfileProvisioner = new LockfileProvisioner(root, 'Test', (): unknown => ({
        lockfileVersion: 1,
      }));

      expect(await bundled.ensure(provision)).toBeNull();
      expect(existsSync(path.join(root, 'demo', '1.0.0', platformKey()))).toBe(false);
    });
  });
});
