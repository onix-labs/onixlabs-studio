import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// The core descriptors construct real providers, one of which reaches Electron.
vi.mock('electron', () => ({ app: { isPackaged: false } }));
import {
  type ManifestNpmProvision,
  parsePluginManifest,
  PluginManifest,
} from '@shared/api/plugin-manifest';
import type { AiConnection } from '@shared/api/ai-types';
import { type LockfilePackage, parseLockfileDocument } from '../provisioning/lockfile-provision';
import { type AgentProviderDescriptor, toHarnessDescriptor } from './agent-provider-registry';

/**
 * Guards the two claims the Claude harness plugin makes about itself, neither of which any other test
 * can see: that its manifest is one this build would actually accept, and that it does not take a
 * connection the built-in Claude provider serves.
 *
 * ⛔ The second is the rule #675 exists to catch by exposure. Contributed harnesses register *ahead* of
 * the ones Studio compiles in, so an incomplete adapter claiming `claude-login` would take that
 * connection and silently drop everything it does not implement — sub-agents, tool policy, MCP, remote
 * control. The user's only symptom would be capability going missing.
 *
 * This is where that stops being a matter of remembering. The day the adapter reaches parity, the
 * in-core provider stops being registered and this test changes with it; until then, changing the
 * manifest to claim `claude-login` fails here rather than in front of somebody's agent.
 */

/**
 * The plugin's manifest, read from the file that ships.
 */
const MANIFEST_PATH: string = path.join(process.cwd(), 'plugins', 'claude-harness', 'plugin.json');

/**
 * The npm package the harness is published as, whose tarball the lockfile names.
 */
const PACKAGE_PATH: string = path.join(process.cwd(), 'plugins', 'claude-harness', 'package.json');

/**
 * The lockfile describing the tree an install reifies.
 */
const LOCKFILE_PATH: string = path.join(
  process.cwd(),
  'src/shared/electron/contributions/plugins/lockfiles/onixlabs.claude-harness.lock.json',
);

/**
 * The curated index, which is what puts the plugin in front of a user at all.
 */
const INDEX_PATH: string = path.join(
  process.cwd(),
  'src/shared/electron/contributions/plugins/curated-plugins.json',
);

describe('the Claude harness plugin', () => {
  const parsed: ReturnType<typeof parsePluginManifest> = parsePluginManifest(
    JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')),
  );

  it('hasAManifestThisBuildAccepts', () => {
    // Not merely well-formed JSON: run through the same validator a sideloaded or indexed manifest
    // goes through, so a contract change that breaks it is caught here rather than at install.
    expect(parsed.errors).toEqual([]);
    expect(parsed.manifest).not.toBeNull();
  });

  it('contributesExactlyOneAgentHarness', () => {
    const manifest: PluginManifest = parsed.manifest!;

    expect(manifest.contributes.agentHarnesses).toHaveLength(1);
  });

  it('cannotClaimAConnectionThatDoesNotNameIt', () => {
    const manifest: PluginManifest = parsed.manifest!;
    const id: string = manifest.contributes.agentHarnesses?.[0]?.id ?? '';
    const descriptor: AgentProviderDescriptor = toHarnessDescriptor(
      {
        id,
        displayName: 'Claude (out of process)',
        priority: 100,
        connectionAuths: manifest.contributes.agentHarnesses?.[0]?.connectionAuths ?? [],
        spawnSpec: (): { command: string; args: readonly string[] } | null => ({
          command: '/bin/harness',
          args: [],
        }),
      },
      () => ({}) as never,
    );

    // ⛔ The rule that replaced auth matching. A plugin cannot take the built-in Claude connection by
    // declaring the same authentication kind — it serves only a connection that names it. Matching on
    // auth would have handed every `claude-login` connection to an adapter that does far less.
    const builtIn: AiConnection = {
      id: 'claude',
      auth: 'claude-login',
      models: [],
      defaultModelId: null,
    } as unknown as AiConnection;
    expect(descriptor.serves(builtIn)).toBe(false);

    const chosen: AiConnection = { ...builtIn, harnessId: id };
    expect(descriptor.serves(chosen)).toBe(true);
  });
});

/**
 * Guards the claims that make the plugin *installable*, as opposed to merely well-formed.
 *
 * ⛔ These exist because the first version of this manifest was none of them and shipped anyway: it
 * pinned a lockfile that did not exist, at a URL outside the directory lockfiles live in, with a
 * placeholder hash, naming an entry point at `claude-harness/main.js` — a path a lockfile-provisioned
 * tree can never contain, because `isConfined` admits nothing outside `node_modules/`. Every one of
 * those failures lands at install time on a user's machine, and none of them is visible to a test that
 * only validates the manifest's shape.
 */
describe('the Claude harness plugin is installable', () => {
  const manifest: PluginManifest = parsePluginManifest(
    JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')),
  ).manifest!;
  const lockfileText: string = readFileSync(LOCKFILE_PATH, 'utf8');
  const packages: readonly LockfilePackage[] = parseLockfileDocument(JSON.parse(lockfileText))!;

  // Narrowed once, here, rather than in each test. The kind is not incidental: an archive provision
  // would put the payload wherever it liked, and every claim below is about a *tree*.
  if (manifest.provision.kind !== 'npm') {
    throw new Error(`Expected an npm provision, found '${manifest.provision.kind}'.`);
  }
  const provision: ManifestNpmProvision = manifest.provision;

  it('pinsTheHashTheLockfileActuallyHas', () => {
    // The pin is a claim about bytes served from the repository, so it is checked against the bytes in
    // the repository. ⚠️ Formatting counts: the committed file is Prettier's output, and a hash taken
    // before formatting is a hash of a file that no longer exists.
    const digest: string = createHash('sha256').update(lockfileText).digest('hex');

    expect(digest).toBe(provision.sha256);
  });

  it('pinsALockfileFromTheDirectoryLockfilesLiveIn', () => {
    // The URL is public API the moment a build ships against it: an installed Studio fetches this exact
    // path, so moving the file breaks installs for versions already out there.
    expect(provision.lockfileUrl).toBe(
      'https://raw.githubusercontent.com/onix-labs/onixlabs-studio/main/' +
        'src/shared/electron/contributions/plugins/lockfiles/onixlabs.claude-harness.lock.json',
    );
  });

  it('namesAnEntryPointTheTreeActuallyDelivers', () => {
    // 🔥 The defect that made the first version unusable. `install` deletes the whole tree and reports
    // failure when the entry point is missing, so an entry point no package provides is not a partial
    // install — it is an install that can never succeed.
    const harness: string = manifest.contributes.agentHarnesses![0].entryPoint ?? '';
    const provided: readonly string[] = packages.map(
      (entry: LockfilePackage): string => entry.path,
    );

    expect(provision.executablePath).toBe(harness);
    expect(provided.some((directory: string): boolean => harness.startsWith(`${directory}/`))).toBe(
      true,
    );
  });

  it('resolvesItsOwnPackageFromTheReleaseRatherThanALocalFile', () => {
    // The lockfile is generated against the tarball on disk, so `resolved` comes out as `file:…` and
    // has to be repointed. Left alone it describes a tree only the machine that generated it can build.
    const own: LockfilePackage | undefined = packages.find(
      (entry: LockfilePackage): boolean => entry.path === 'node_modules/@onixlabs/claude-harness',
    );

    expect(own?.url).toBe(
      'https://github.com/onix-labs/onixlabs-studio/releases/download/' +
        'claude-harness-v0.1.0/onixlabs-claude-harness-0.1.0.tgz',
    );
  });

  it('publishesTheVersionTheManifestNames', () => {
    // The release tag, the asset filename and the index entry are all derived from one of these two
    // numbers. They disagreeing is a release that publishes to a URL nothing points at.
    const pkg: { version: string } = JSON.parse(readFileSync(PACKAGE_PATH, 'utf8')) as {
      version: string;
    };

    expect(pkg.version).toBe(manifest.version);
  });

  it('fetchesOnlyTheSdkBinariesThisPlatformCanRun', () => {
    // 🔑 Why this is provisioned as a tree rather than an archive. The SDK ships its CLI as eight
    // platform builds of around 200MB each; the lockfile's `os`/`cpu` filter is what turns that into a
    // download of one or two rather than eight. A lockfile that lost those fields would install all of
    // them, and an archive provision would have meant hand-building five assets of that size.
    //
    // ⚠️ Linux gets TWO: the glibc and musl builds differ by npm's `libc` field, which `parseLockfile`
    // does not read — so a Linux install fetches around 400MB where a Mac or Windows install fetches
    // 200MB. Recorded here rather than asserted away, because it is a real cost and the fix is a change
    // to shared provisioning (detecting musl at runtime), not to this plugin.
    const expected: Record<string, readonly string[]> = {
      'darwin arm64': ['darwin-arm64'],
      'darwin x64': ['darwin-x64'],
      'win32 x64': ['win32-x64'],
      'linux x64': ['linux-x64', 'linux-x64-musl'],
      'linux arm64': ['linux-arm64', 'linux-arm64-musl'],
    };

    for (const [key, suffixes] of Object.entries(expected)) {
      const [platform, architecture] = key.split(' ');
      const selected: readonly LockfilePackage[] = parseLockfileDocument(
        JSON.parse(lockfileText),
        platform,
        architecture,
      )!.filter((entry: LockfilePackage): boolean =>
        entry.path.startsWith('node_modules/@anthropic-ai/claude-agent-sdk-'),
      );

      expect(selected.map((entry: LockfilePackage): string => entry.path).sort()).toEqual(
        suffixes.map(
          (suffix: string): string => `node_modules/@anthropic-ai/claude-agent-sdk-${suffix}`,
        ),
      );
    }
  });

  it('isCarriedByTheCuratedIndex', () => {
    // ⛔ The Plugin Manager lists what is sideloaded or indexed, and nothing else. A plugin absent from
    // the index is not "not installed" — it is invisible, with no way for a user to reach it.
    const index: { plugins: readonly { id: string }[] } = JSON.parse(
      readFileSync(INDEX_PATH, 'utf8'),
    ) as { plugins: readonly { id: string }[] };
    const entry: { id: string } | undefined = index.plugins.find(
      (plugin: { id: string }): boolean => plugin.id === manifest.id,
    );

    // Deep equality against the manifest as written, not as parsed: the index holds a *copy* of that
    // document, and the ways the two drift are exactly the ways an install breaks.
    expect(entry).toEqual(JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')));
  });
});
