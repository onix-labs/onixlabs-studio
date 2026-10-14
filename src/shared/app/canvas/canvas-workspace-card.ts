import { ChangeDetectionStrategy, Component, input, InputSignal, signal } from '@angular/core';
import type { ForgeHostAccount, ForgeResult } from '@shared/api/forge-types';
import type { HostedAccount } from '@shared/api/hosting-protocol';
import type { PluginSummary } from '@shared/api/plugin-channels';
import type { VersionControlPluginInfo } from '@shared/api/source-control-channels';
import { AgentWorkspaceCard } from '@shared/angular/components/agent-cards/agent-workspace-card/agent-workspace-card';
import type { AgentItem } from '@shared/angular/services/agent/agent';
import { Clone } from '@shared/angular/services/clone/clone';
import { Forge } from '@shared/angular/services/forge/forge';
import { Plugins } from '@shared/angular/services/plugins/plugins';
import { SourceControl } from '@shared/angular/services/source-control/source-control';
import { WorkspaceProposals } from '@shared/angular/services/workspace-proposals/workspace-proposals';

/**
 * Builds an installed plugin filling a slot, for the canvas's stand-in machine.
 * @param slot The slot.
 * @returns Returns its summary.
 */
function installed(slot: 'version-control' | 'hosting'): PluginSummary {
  return {
    id: `canvas.${slot}`,
    state: 'installed',
    contributions: [{ slot, id: `canvas.${slot}` }],
  } as unknown as PluginSummary;
}

/**
 * Renders the workspace card (#876) as it appears in an agent tab: over a machine with Git and GitHub
 * installed, one signed-in account, and a folder projects go into, so every field it can offer is on
 * show. Creating from the canvas does nothing.
 */
@Component({
  selector: 'app-canvas-workspace-card',
  imports: [AgentWorkspaceCard],
  template: '<app-agent-workspace-card [item]="item()" />',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: Plugins,
      useValue: { plugins: signal([installed('version-control'), installed('hosting')]) },
    },
    {
      provide: Clone,
      useValue: {
        parent: (): Promise<string> => Promise.resolve('/Users/matthew/Development'),
        pickParent: (): Promise<null> => Promise.resolve(null),
      },
    },
    {
      provide: Forge,
      useValue: {
        isAvailable: true,
        hosts: (): Promise<readonly ForgeHostAccount[]> =>
          Promise.resolve([
            {
              host: 'github.com',
              provider: 'GitHub',
              status: { authenticated: true },
            } as unknown as ForgeHostAccount,
          ]),
        accounts: (): Promise<ForgeResult<readonly HostedAccount[]>> =>
          Promise.resolve({
            ok: true,
            value: [{ login: 'MrMatthewLayton', name: null, kind: 'user' }],
          }),
      },
    },
    {
      provide: SourceControl,
      useValue: {
        client: {
          listPlugins: (): Promise<readonly VersionControlPluginInfo[]> =>
            Promise.resolve([
              { id: 'canvas.git', installed: true, capabilities: ['clone', 'init'] },
            ] as unknown as VersionControlPluginInfo[]),
        },
      },
    },
    {
      provide: WorkspaceProposals,
      useValue: {
        create: (): Promise<null> => Promise.resolve(null),
        dismiss: (): void => undefined,
      },
    },
  ],
})
export class CanvasWorkspaceCard {
  /**
   * Gets the proposal to show.
   */
  public readonly item: InputSignal<AgentItem> = input.required<AgentItem>();
}
