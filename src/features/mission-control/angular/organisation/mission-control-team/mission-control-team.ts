import {
  ChangeDetectionStrategy,
  Component,
  inject,
  Signal,
  signal,
  WritableSignal,
} from '@angular/core';
import { Avatar } from '@shared/angular/components/avatar/avatar';
import { Button } from '@shared/angular/components/forms/button/button';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import {
  ListEdit,
  ListMenuSelection,
  ListRow,
  ListView,
} from '@shared/angular/components/list-view/list-view';
import { MenuItem } from '@shared/angular/components/menu/menu';
import { PulseDot } from '@shared/angular/components/pulse-dot/pulse-dot';
import { Icon } from '@shared/angular/icons/icon';
import { AgentHost, AgentHosts } from '@shared/angular/services/agent-hosts/agent-hosts';
import { ForgeProject } from '@shared/angular/services/forge-projects/forge-projects';
import { Log } from '@shared/angular/services/log/log';
import { OrganisationAgent, OrganisationRole } from '@shared/api/organisation';
import { MissionControl } from '../../mission-control/mission-control';
import { MissionControlWorkItems } from '../../hierarchy/work-items';
import { HostedOrgAgent, MissionControlOrgAgents } from '../org-agents';
import { MissionControlOrganisations, ProjectOrganisation } from '../organisations';

/**
 * One agent on a project's roster, as a row of the team list.
 */
export interface TeamRowData {
  /**
   * Gets the project the agent works on.
   */
  readonly project: ForgeProject;

  /**
   * Gets the agent.
   */
  readonly agent: OrganisationAgent;

  /**
   * Gets the title of the role the agent holds.
   */
  readonly roleTitle: string;

  /**
   * Gets the number of the work item the agent is assigned to, or null.
   */
  readonly workItem: number | null;

  /**
   * Gets where the agent's session is: not hosted, hosted and idle, or running a turn.
   */
  readonly status: 'away' | 'idle' | 'working';
}

/**
 * The menu item identifiers of an agent's row, with the role and assignment items' prefixes.
 */
const MENU: {
  readonly chat: string;
  readonly rename: string;
  readonly unassign: string;
  readonly remove: string;
  readonly rolePrefix: string;
} = {
  chat: 'chat',
  rename: 'rename',
  unassign: 'unassign',
  remove: 'remove',
  rolePrefix: 'role:',
};

/**
 * Mission Control's Team face (epic #788, P2): each open project's named agents — who they are, the
 * role they hold, what they are assigned to and whether they are working — and the controls to hire,
 * rename, move and let them go. Opening an agent's chat hosts it and shows its column on the Agents
 * face.
 */
@Component({
  selector: 'app-mission-control-team',
  imports: [AppIcon, Avatar, Button, Dropdown, ListView, PulseDot, TextField],
  templateUrl: './mission-control-team.html',
  styleUrl: './mission-control-team.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MissionControlTeam {
  /**
   * Holds the open projects' work items, the source of the project list.
   */
  private readonly workItems: MissionControlWorkItems = inject(MissionControlWorkItems);

  /**
   * Holds every open project's organisation.
   */
  protected readonly organisations: MissionControlOrganisations = inject(
    MissionControlOrganisations,
  );

  /**
   * Holds the hosted named agents.
   */
  private readonly orgAgents: MissionControlOrgAgents = inject(MissionControlOrgAgents);

  /**
   * Holds the app-wide live-agent registry, to find a hosted agent's tile.
   */
  private readonly agentHosts: AgentHosts = inject(AgentHosts);

  /**
   * Holds Mission Control's shared view state.
   */
  private readonly missionControl: MissionControl = inject(MissionControl);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the open projects.
   */
  protected readonly projects: Signal<readonly ForgeProject[]> = this.workItems.projects;

  /**
   * Holds the selected row's id.
   */
  protected readonly selectedId: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds the id of the row being renamed, or null.
   */
  protected readonly editingId: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds the name a rename starts from.
   */
  protected readonly editValue: WritableSignal<string> = signal<string>('');

  /**
   * Holds each project's hire form: the name typed and the role chosen, keyed by project.
   */
  protected readonly drafts: WritableSignal<
    ReadonlyMap<string, { readonly name: string; readonly roleId: string }>
  > = signal<ReadonlyMap<string, { readonly name: string; readonly roleId: string }>>(
    new Map<string, { readonly name: string; readonly roleId: string }>(),
  );

  /**
   * Builds a project's roster rows.
   * @param project The project.
   * @returns Returns the rows.
   */
  protected rowsFor(project: ForgeProject): readonly ListRow[] {
    const state: ProjectOrganisation = this.organisations.stateFor(project.key);
    return state.organisation.agents.map((agent: OrganisationAgent): ListRow => {
      const hosted: HostedOrgAgent | undefined = this.orgAgents.hostFor(project.key, agent.id);
      const data: TeamRowData = {
        project,
        agent,
        roleTitle: this.organisations.roleFor(project.key, agent.roleId)?.title ?? agent.roleId,
        workItem: this.organisations.agentState(project.key, agent.id).workItem,
        status: hosted === undefined ? 'away' : hosted.agent.isRunning() ? 'working' : 'idle',
      };
      return { id: `${project.key}::${agent.id}`, data };
    });
  }

  /**
   * Gets the role choices for a project.
   * @param project The project.
   * @returns Returns the choices.
   */
  protected roleOptions(project: ForgeProject): readonly DropdownOption[] {
    return this.organisations
      .stateFor(project.key)
      .organisation.roles.map((role: OrganisationRole): DropdownOption => ({
        value: role.id,
        label: role.title,
      }));
  }

  /**
   * Narrows a row's payload for the template.
   * @param row The row.
   * @returns Returns its payload.
   */
  protected dataOf(row: ListRow): TeamRowData {
    return row.data as TeamRowData;
  }

  /**
   * Gets a project's hire form.
   * @param project The project.
   * @returns Returns the name typed and the role chosen.
   */
  protected draftFor(project: ForgeProject): { readonly name: string; readonly roleId: string } {
    return this.drafts().get(project.key) ?? { name: '', roleId: 'engineer' };
  }

  /**
   * Updates a project's hire form.
   * @param project The project.
   * @param change The fields to change.
   */
  protected setDraft(
    project: ForgeProject,
    change: Partial<{ readonly name: string; readonly roleId: string }>,
  ): void {
    this.drafts.update(
      (
        current: ReadonlyMap<string, { readonly name: string; readonly roleId: string }>,
      ): ReadonlyMap<string, { readonly name: string; readonly roleId: string }> =>
        new Map(current).set(project.key, { ...this.draftFor(project), ...change }),
    );
  }

  /**
   * Hires the agent a project's form describes, then clears the name for the next.
   * @param project The project.
   */
  protected onHire(project: ForgeProject): void {
    const draft: { readonly name: string; readonly roleId: string } = this.draftFor(project);
    const agent: OrganisationAgent | null = this.organisations.addAgent(
      project,
      draft.name,
      draft.roleId,
    );
    if (agent !== null) {
      this.setDraft(project, { name: '' });
      this.selectedId.set(`${project.key}::${agent.id}`);
    }
  }

  /**
   * Builds a row's context menu. Bound as a value: the list calls it with `this` unbound.
   */
  protected readonly menuFor: (row: ListRow) => readonly MenuItem[] = (
    row: ListRow,
  ): readonly MenuItem[] => {
    const data: TeamRowData = this.dataOf(row);
    return [
      { id: MENU.chat, label: 'Open Chat', icon: Icon.MISSION_CONTROL_AGENTS },
      { id: MENU.rename, label: 'Rename' },
      {
        id: 'role',
        label: 'Role',
        children: this.organisations
          .stateFor(data.project.key)
          .organisation.roles.map((role: OrganisationRole): MenuItem => ({
            id: `${MENU.rolePrefix}${role.id}`,
            label: role.title,
            checked: role.id === data.agent.roleId,
          })),
      },
      { id: MENU.unassign, label: 'Unassign', disabled: data.workItem === null },
      { id: 'separator', label: '', separator: true },
      { id: MENU.remove, label: 'Let Go', tone: 'danger' },
    ];
  };

  /**
   * Acts on a row's context-menu choice.
   * @param selection The choice and the row it was made on.
   */
  protected onMenu(selection: ListMenuSelection): void {
    const data: TeamRowData = this.dataOf(selection.row);
    const { project, agent } = data;
    if (selection.itemId.startsWith(MENU.rolePrefix)) {
      this.organisations.setRole(project, agent.id, selection.itemId.slice(MENU.rolePrefix.length));
      return;
    }
    switch (selection.itemId) {
      case MENU.chat:
        this.openChat(project, agent);
        return;
      case MENU.rename:
        this.editValue.set(agent.name);
        this.editingId.set(selection.row.id);
        return;
      case MENU.unassign:
        this.organisations.assign(project, agent.id, null);
        return;
      case MENU.remove:
        this.organisations.remove(project, agent.id);
        return;
    }
  }

  /**
   * Commits a rename.
   * @param edit The row and its new name.
   */
  protected onRename(edit: ListEdit): void {
    const data: TeamRowData = this.dataOf(edit.row);
    this.organisations.rename(data.project, data.agent.id, edit.value);
    this.editingId.set(null);
  }

  /**
   * Hosts an agent and shows its column on the Agents face.
   * @param project The project.
   * @param agent The agent.
   */
  protected openChat(project: ForgeProject, agent: OrganisationAgent): void {
    const hosted: HostedOrgAgent = this.orgAgents.open(project, agent);
    const host: AgentHost | undefined = this.agentHosts
      .hosts()
      .find((candidate: AgentHost): boolean => candidate.agent === hosted.agent);
    this.log.info('mission-control', 'Opening named agent chat', project.key, agent.id);
    if (host === undefined) {
      this.missionControl.setFace('agents');
      return;
    }
    this.missionControl.revealHost(host.id);
  }
}
