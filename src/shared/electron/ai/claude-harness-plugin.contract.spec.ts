import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// The core descriptors construct real providers, one of which reaches Electron.
vi.mock('electron', () => ({ app: { isPackaged: false } }));
import { parsePluginManifest, PluginManifest } from '@shared/api/plugin-manifest';
import type { AiConnection } from '@shared/api/ai-types';
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
