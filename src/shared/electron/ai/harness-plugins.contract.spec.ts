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
import { AGENT_PROTOCOL_VERSION, isProtocolCompatible } from '@shared/api/agent-protocol';
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
        sessionModel: 'stateless',
        remoteControl: false,
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
 * Guards the claims that make a harness plugin *installable*, as opposed to merely well-formed.
 *
 * ⛔ These exist because the first published manifest was none of them and shipped anyway: it pinned a
 * lockfile that did not exist, at a URL outside the directory lockfiles live in, with a placeholder
 * hash, naming an entry point at `claude-harness/main.js` — a path a lockfile-provisioned tree can never
 * contain, because `isConfined` admits nothing outside `node_modules/`. Every one of those failures
 * lands at install time on a user's machine, and none is visible to a test that only validates shape.
 *
 * Run over **every** harness plugin rather than written once per plugin: the second harness is exactly
 * when a copied spec starts drifting from the one it was copied from.
 */
describe.each(['claude-harness', 'codex-harness', 'ai-sdk-harness'])(
  'the %s plugin is installable',
  (name: string) => {
    const directory: string = path.join(process.cwd(), 'plugins', name);
    const manifestPath: string = path.join(directory, 'plugin.json');
    const manifest: PluginManifest = parsePluginManifest(
      JSON.parse(readFileSync(manifestPath, 'utf8')),
    ).manifest!;
    const lockfilePath: string = path.join(
      process.cwd(),
      `src/shared/electron/contributions/plugins/lockfiles/onixlabs.${name}.lock.json`,
    );
    const lockfileText: string = readFileSync(lockfilePath, 'utf8');
    const packages: readonly LockfilePackage[] = parseLockfileDocument(JSON.parse(lockfileText))!;
    const pkg: { name: string; version: string; dependencies?: Record<string, string> } =
      JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8')) as {
        name: string;
        version: string;
        dependencies?: Record<string, string>;
      };

    // Narrowed once. The kind is not incidental: an archive provision would put the payload wherever it
    // liked, and every claim below is about a *tree*.
    if (manifest.provision.kind !== 'npm') {
      throw new Error(`Expected an npm provision, found '${manifest.provision.kind}'.`);
    }
    const provision: ManifestNpmProvision = manifest.provision;

    it('pinsTheHashTheLockfileActuallyHas', () => {
      // The pin is a claim about bytes served from the repository, so it is checked against the bytes in
      // the repository. ⚠️ Formatting counts: the committed file is Prettier's output, and a hash taken
      // before formatting is a hash of a file that no longer exists.
      expect(createHash('sha256').update(lockfileText).digest('hex')).toBe(provision.sha256);
    });

    it('pinsALockfileFromTheDirectoryLockfilesLiveIn', () => {
      // The URL is public API the moment a build ships against it: an installed Studio fetches this exact
      // path, so moving the file breaks installs for versions already out there.
      expect(provision.lockfileUrl).toBe(
        'https://raw.githubusercontent.com/onix-labs/onixlabs-studio/main/' +
          `src/shared/electron/contributions/plugins/lockfiles/onixlabs.${name}.lock.json`,
      );
    });

    it('namesAnEntryPointTheTreeActuallyDelivers', () => {
      // 🔥 The defect that made the first published manifest unusable. `install` deletes the whole tree
      // and reports failure when the entry point is missing, so an entry point no package provides is not
      // a partial install — it is an install that can never succeed.
      const harness: string = manifest.contributes.agentHarnesses![0].entryPoint ?? '';
      const provided: readonly string[] = packages.map(
        (entry: LockfilePackage): string => entry.path,
      );

      expect(provision.executablePath).toBe(harness);
      expect(
        provided.some((directoryPath: string): boolean => harness.startsWith(`${directoryPath}/`)),
      ).toBe(true);
    });

    it('resolvesItsOwnPackageFromTheReleaseRatherThanALocalFile', () => {
      // The lockfile is generated against the tarball on disk, so `resolved` comes out as `file:…` and has
      // to be repointed. Left alone it describes a tree only the machine that generated it can build.
      const own: LockfilePackage | undefined = packages.find(
        (entry: LockfilePackage): boolean => entry.path === `node_modules/${pkg.name}`,
      );

      expect(own?.url).toBe(
        'https://github.com/onix-labs/onixlabs-studio/releases/download/' +
          `${name}-v${pkg.version}/onixlabs-${name}-${pkg.version}.tgz`,
      );
    });

    it('shipsEveryDependencyItDeclares', () => {
      // 🔥 The failure this catches is invisible until a user installs. A harness leaves a dependency
      // external when the bundle cannot inline it (a per-platform native binary), and the lockfile is
      // what then delivers it — so a dependency added to `package.json` without the lockfile being
      // regenerated produces a tree that installs cleanly and throws at the first `require`.
      //
      // ⚠️ Not the same as "the lockfile is complete". A harness that bundles its SDK declares nothing
      // here and is correct with a one-package lockfile; this only says the two documents agree.
      const provided: readonly string[] = packages.map((entry: LockfilePackage): string =>
        entry.path.replace(/^node_modules\//, ''),
      );

      for (const dependency of Object.keys(pkg.dependencies ?? {})) {
        expect(provided).toContain(dependency);
      }
    });

    it('publishesTheVersionTheManifestNames', () => {
      // The release tag, the asset filename and the index entry are all derived from one of these two
      // numbers. Disagreeing is a release published to a URL nothing points at.
      expect(pkg.version).toBe(manifest.version);
    });

    it('declaresAProtocolVersionThisBuildStillHonours', () => {
      // 🔥 A published plugin speaks the version it was built against, not this build's. The "an older
      // minor is fine" rule is the only thing keeping an installed copy working; a major bump would refuse
      // it at the handshake and the connection would stop working with no visible cause.
      const source: string = readFileSync(path.join(directory, 'src', 'protocol.ts'), 'utf8');
      const declared: string = /PROTOCOL_VERSION: string = '([^']+)'/.exec(source)?.[1] ?? '';

      expect(declared).not.toBe('');
      expect(isProtocolCompatible(declared, AGENT_PROTOCOL_VERSION)).toBe(true);
    });

    it('agreesWithItsHandshakeAboutTheSessionModel', () => {
      // ⛔ Studio refuses a harness whose handshake contradicts its manifest, because it has already
      // committed to holding a process open on the manifest's word. That failure would only appear when
      // somebody ran a turn; here it appears when somebody edits either file.
      const source: string = readFileSync(path.join(directory, 'src', 'main.ts'), 'utf8');
      const declared: string = /sessionModel: '([^']+)'/.exec(source)?.[1] ?? '';

      expect(declared).toBe(manifest.contributes.agentHarnesses![0].sessionModel ?? 'stateless');
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
      expect(entry).toEqual(JSON.parse(readFileSync(manifestPath, 'utf8')));
    });
  },
);
