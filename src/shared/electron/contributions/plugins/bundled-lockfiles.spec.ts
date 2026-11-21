import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { bundledLockfile } from './bundled-lockfiles';
import CURATED_PLUGINS from './curated-plugins.json';

/**
 * The directory lockfiles live in.
 */
const LOCKFILES: string = path.resolve('src/shared/electron/contributions/plugins/lockfiles');

/**
 * Describes an npm-provisioned entry of the curated index, as far as these tests read it.
 */
interface NpmEntry {
  /**
   * Gets the plugin's id.
   */
  readonly id: string;

  /**
   * Gets the plugin's version.
   */
  readonly version: string;

  /**
   * Gets how it is provisioned.
   */
  readonly provision: {
    readonly kind: string;
    readonly lockfileUrl: string;
    readonly sha256: string;
  };
}

/**
 * The entries of the curated index that install from a lockfile.
 */
const NPM_ENTRIES: readonly NpmEntry[] = (
  CURATED_PLUGINS.plugins as unknown as readonly NpmEntry[]
).filter((entry: NpmEntry): boolean => entry.provision.kind === 'npm');

/**
 * Maps each first-party plugin's id to its directory under `plugins/`.
 */
const FIRST_PARTY: ReadonlyMap<string, string> = new Map<string, string>(
  readdirSync('plugins')
    .filter((directory: string): boolean =>
      existsSync(path.join('plugins', directory, 'plugin.json')),
    )
    .map((directory: string): [string, string] => [
      (
        JSON.parse(readFileSync(path.join('plugins', directory, 'plugin.json'), 'utf8')) as {
          id: string;
        }
      ).id,
      directory,
    ]),
);

describe('bundledLockfile', () => {
  it.each(NPM_ENTRIES.map((entry: NpmEntry): [string, NpmEntry] => [entry.id, entry]))(
    'ships %s, and ships the bytes its pin names',
    (_id: string, entry: NpmEntry) => {
      const file: string = path.join(LOCKFILES, entry.provision.lockfileUrl.split('/').pop()!);
      const bytes: Buffer = readFileSync(file);

      // The bundled copy is matched to a request through the seed's pin, so the file compiled in must
      // be the very bytes that pin names.
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.provision.sha256);
      expect(bundledLockfile(entry.provision.lockfileUrl, entry.provision.sha256)).toEqual(
        JSON.parse(bytes.toString('utf8')),
      );
    },
  );

  it('servesNothing_forAPinTheSeedDoesNotCarry', () => {
    const entry: NpmEntry = NPM_ENTRIES[0];

    // What a fetched index pinning a newer release asks for: it must download and check that release,
    // not be answered with the older tree compiled in.
    expect(bundledLockfile(entry.provision.lockfileUrl, 'f'.repeat(64))).toBeNull();
  });

  it('servesNothing_forALockfileItDoesNotShip', () => {
    expect(bundledLockfile('https://example.com/unknown.lock.json', 'a'.repeat(64))).toBeNull();
  });
});

describe('curated lockfile URLs', () => {
  it.each(
    NPM_ENTRIES.filter((entry: NpmEntry): boolean => FIRST_PARTY.has(entry.id)).map(
      (entry: NpmEntry): [string, NpmEntry] => [entry.id, entry],
    ),
  )('pins %s to its own release tag, never to a branch', (_id: string, entry: NpmEntry) => {
    // (Third-party servers, which have no tag of their own, are held to a version-named file below.)
    // A URL naming a branch serves whatever the branch holds today, so a later bump changes the bytes
    // under a pin an installed build already carries, and that build can no longer install the plugin.
    // The release tag's bytes never change.
    const tag: string = `plugin-${FIRST_PARTY.get(entry.id)}-v${entry.version}`;

    expect(entry.provision.lockfileUrl).toBe(
      `https://raw.githubusercontent.com/onix-labs/onixlabs-studio/${tag}/` +
        'src/shared/electron/contributions/plugins/lockfiles/' +
        entry.provision.lockfileUrl.split('/').pop(),
    );
  });

  it.each(
    NPM_ENTRIES.filter((entry: NpmEntry): boolean => !FIRST_PARTY.has(entry.id)).map(
      (entry: NpmEntry): [string, NpmEntry] => [entry.id, entry],
    ),
  )('pins %s to a lockfile named for its version', (_id: string, entry: NpmEntry) => {
    // A third-party server has no release tag here, so its lockfile is served from `main`. Naming the
    // file for the version makes the URL immutable all the same: a new version is a new file, and the
    // bytes under a URL an index already pins never change (#1467).
    expect(entry.provision.lockfileUrl).toBe(
      'https://raw.githubusercontent.com/onix-labs/onixlabs-studio/main/' +
        `src/shared/electron/contributions/plugins/lockfiles/${entry.id}-${entry.version}.lock.json`,
    );
  });
});

describe('legacy lockfiles', () => {
  /**
   * The unversioned lockfiles builds before #1467 pin at `main`, with the hash the latest of them pin.
   *
   * Frozen. A build that predates bundled lockfiles, and has never fetched a newer index, still
   * downloads these from `main` and checks them against its own pin, so changing one would stop that
   * build installing the server. A new version of a server is a new, version-named file instead.
   */
  const LEGACY: Readonly<Record<string, string>> = {
    'bash-language-server.lock.json':
      '8c13cf54220250fd33cf79fb872fda5cca79fc204463b4e1645ece205ad8969f',
    'dockerfile-language-server.lock.json':
      'ce51bba16fd25abc8db7532a7b16acf0c0e683270ac8e94b2561276a4613d67f',
    'svelte-language-server.lock.json':
      '02dcbd8c721d2404e3a8b0e3d4c18ab8ee9fdcecfe0cf6dcd800d4ab22c7c40f',
    'vscode-langservers-extracted.lock.json':
      '2e9cfac6ede4f8b4e5facd11f34f42cc875f0b5feb2984636709b4fb824a9739',
    'yaml-language-server.lock.json':
      'c4c3136a019386738fc0ccc1ba91c69025fae4485a3d32936b01001c5d8431eb',
  };

  it.each(Object.entries(LEGACY))(
    'keeps %s exactly as older builds pin it',
    (name: string, pin: string) => {
      const bytes: Buffer = readFileSync(path.join(LOCKFILES, name));

      expect(createHash('sha256').update(bytes).digest('hex')).toBe(pin);
    },
  );
});
