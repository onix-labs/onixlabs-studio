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
});
