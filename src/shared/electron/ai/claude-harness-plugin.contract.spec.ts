import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// The core descriptors construct real providers, one of which reaches Electron.
vi.mock('electron', () => ({ app: { isPackaged: false } }));
import { parsePluginManifest, PluginManifest } from '@shared/api/plugin-manifest';
import { coreAgentProviders } from './agent-provider-registry';

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

  it('doesNotClaimAConnectionABuiltInHarnessAlreadyServes', () => {
    const manifest: PluginManifest = parsed.manifest!;
    const claimed: readonly string[] =
      manifest.contributes.agentHarnesses?.[0]?.connectionAuths ?? [];

    // The built-in descriptors, asked whether they would serve each auth this plugin claims. The
    // generic AI-SDK descriptor is excluded because it serves everything — falling through to it is a
    // fallback, not a capability being taken.
    const displaced: readonly string[] = claimed.filter((auth: string): boolean =>
      coreAgentProviders()
        .filter((core): boolean => core.id !== 'ai-sdk')
        .some((core): boolean =>
          core.serves({ id: 'probe', auth, models: [], defaultModelId: null } as never),
        ),
    );

    expect(
      displaced,
      'This adapter is not at parity with the in-core Claude provider. Claiming an auth kind it ' +
        'serves would silently drop sub-agents, tool policy, MCP and remote control.',
    ).toEqual([]);
  });
});
