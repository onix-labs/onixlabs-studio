import { Provider, signal, WritableSignal } from '@angular/core';
import type { ForgeHostAccount, ForgeResult } from '@shared/api/forge-types';
import type { HostedAccount } from '@shared/api/hosting-protocol';
import type {
  NewProjectOutcome,
  NewProjectRequest,
  PickedDocuments,
} from '@shared/api/new-project-channels';
import type { PluginSummary } from '@shared/api/plugin-channels';
import type { Skill, SkillSaveResult } from '@shared/api/skill-channels';
import type { VersionControlPluginInfo } from '@shared/api/source-control-channels';
import type { VersionControlCapability } from '@shared/api/version-control-protocol';
import { Clone } from '@shared/angular/services/clone/clone';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { Forge } from '@shared/angular/services/forge/forge';
import { NewProject } from '@shared/angular/services/new-project/new-project';
import { Plugins } from '@shared/angular/services/plugins/plugins';
import { Skills } from '@shared/angular/services/skills/skills';
import { SourceControl } from '@shared/angular/services/source-control/source-control';
import type { WorkspaceAgentStart } from '@shared/angular/services/workspaces/workspaces';

/**
 * Stands in for everything the New Project wizard's draft asks of the machine (#806), recording what
 * it was asked, for the wizard's specs.
 */
export class FakeProjectMachine {
  /**
   * Holds the installed plugins.
   */
  public readonly plugins: WritableSignal<readonly PluginSummary[]> = signal<
    readonly PluginSummary[]
  >([installed('version-control'), installed('hosting')]);

  /**
   * Holds the folder projects go into.
   */
  public parent: string | null = '/Users/me/Development';

  /**
   * Holds what the folder dialog answers.
   */
  public picked: string | null = '/Users/me/Projects';

  /**
   * Holds the accounts the signed-in host lists.
   */
  public accounts: HostedAccount[] = [{ login: 'matthew', name: null, kind: 'user' }];

  /**
   * Holds the capabilities the running version-control plugin confirms.
   */
  public running: VersionControlCapability[] = ['clone', 'init'];

  /**
   * Holds the skills in the library.
   */
  public skills: Skill[] = [];

  /**
   * Holds what importing a skill answers: null when the dialog is cancelled.
   */
  public importResult: SkillSaveResult | null = null;

  /**
   * Holds what making a project answers.
   */
  public outcome: NewProjectOutcome = { ok: true, path: '/Users/me/Development/todo-app' };

  /**
   * Holds what picking documents answers.
   */
  public documents: PickedDocuments = { documents: [], skipped: [] };

  /**
   * Holds the projects asked for.
   */
  public readonly created: NewProjectRequest[] = [];

  /**
   * Holds the folders opened, each with the agent start handed to it.
   */
  public readonly opened: { path: string; start: WorkspaceAgentStart | undefined }[] = [];

  /**
   * Gets the providers that put this machine in place of the real one.
   * @returns Returns the providers.
   */
  public providers(): Provider[] {
    return [
      { provide: Plugins, useValue: { plugins: this.plugins } },
      {
        provide: Clone,
        useValue: {
          parent: (): Promise<string | null> => Promise.resolve(this.parent),
          pickParent: (): Promise<string | null> => Promise.resolve(this.picked),
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
            Promise.resolve({ ok: true, value: this.accounts }),
        },
      },
      {
        provide: SourceControl,
        useValue: {
          client: {
            listPlugins: (): Promise<readonly VersionControlPluginInfo[]> =>
              Promise.resolve([
                { id: 'test.git', installed: true, capabilities: this.running },
              ] as unknown as VersionControlPluginInfo[]),
          },
        },
      },
      {
        provide: NewProject,
        useValue: {
          create: (request: NewProjectRequest): Promise<NewProjectOutcome> => {
            this.created.push(request);
            return Promise.resolve(this.outcome);
          },
          pickDocuments: (): Promise<PickedDocuments> => Promise.resolve(this.documents),
        },
      },
      {
        provide: FileOpener,
        useValue: {
          reopenDirectory: (path: string, start?: WorkspaceAgentStart): Promise<boolean> => {
            this.opened.push({ path, start });
            return Promise.resolve(true);
          },
        },
      },
      {
        provide: Skills,
        useValue: {
          skills: (): readonly Skill[] => this.skills,
          import: (): Promise<SkillSaveResult | null> => Promise.resolve(this.importResult),
        },
      },
    ];
  }
}

/**
 * Builds an installed plugin filling a slot.
 * @param slot The slot.
 * @returns Returns its summary.
 */
export function installed(slot: 'version-control' | 'hosting'): PluginSummary {
  return {
    id: `test.${slot}`,
    state: 'installed',
    contributions: [{ slot, id: `test.${slot}` }],
  } as unknown as PluginSummary;
}
