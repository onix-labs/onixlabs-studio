import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  ListEdit,
  ListMenuSelection,
  ListRow,
} from '@shared/angular/components/list-view/list-view';
import { MenuItem } from '@shared/angular/components/menu/menu';
import { AgentHost, AgentHosts } from '@shared/angular/services/agent-hosts/agent-hosts';
import { AiRuntime } from '@shared/angular/services/ai-runtime/ai-runtime';
import {
  ForgeProject,
  ForgeProjects,
} from '@shared/angular/services/forge-projects/forge-projects';
import { OrganisationFiles } from '@shared/angular/services/organisation-files/organisation-files';
import { Settings } from '@shared/angular/services/settings/settings';
import { ForgeRepositoryRef } from '@shared/api/forge-types';
import {
  Organisation,
  OrganisationAgent,
  OrganisationUser,
  parseOrganisation,
} from '@shared/api/organisation';
import { OrganisationSnapshot } from '@shared/api/organisation-channels';
import { MissionControl } from '../../mission-control/mission-control';
import { HostedOrgAgent, MissionControlOrgAgents } from '../org-agents';
import { MissionControlOrganisations } from '../organisations';
import { MissionControlTeam } from './mission-control-team';

/**
 * The repository the tests open.
 */
const STUDIO: ForgeRepositoryRef = {
  kind: 'github',
  host: 'github.com',
  owner: 'onix-labs',
  name: 'onixlabs-studio',
};

/**
 * The team internals the tests reach into (protected on the component).
 */
interface TeamInternals {
  readonly menuFor: (row: ListRow) => readonly MenuItem[];
  rowsFor(project: ForgeProject): readonly ListRow[];
  onMenu(selection: ListMenuSelection): void;
  onRename(edit: ListEdit): void;
  readonly editingId: () => string | null;
}

/**
 * Lets queued promises settle.
 */
async function settle(): Promise<void> {
  for (let turn: number = 0; turn < 10; turn++) {
    await Promise.resolve();
  }
}

describe('MissionControlTeam', () => {
  let fixture: ComponentFixture<MissionControlTeam>;
  let projects: ForgeProjects;
  let organisations: MissionControlOrganisations;
  let team: TeamInternals;
  let roster: Organisation;

  beforeEach(() => {
    roster = parseOrganisation({
      agents: [{ id: 'ada', name: 'Ada Lovelace', roleId: 'engineer' }],
    });
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AiRuntime,
          useValue: {
            onEvent: (): (() => void) => (): void => undefined,
            listProviders: (): Promise<readonly never[]> => Promise.resolve([]),
            checkClaudeAuth: (): Promise<boolean> => Promise.resolve(true),
            closeSession: (): void => undefined,
          },
        },
        {
          provide: OrganisationFiles,
          useValue: {
            load: (): Promise<OrganisationSnapshot | null> =>
              Promise.resolve({ organisation: roster, user: { agents: [] } }),
            save: (_root: string, organisation: Organisation): Promise<Organisation | null> =>
              Promise.resolve(parseOrganisation(organisation)),
            saveUser: (_root: string, user: OrganisationUser): Promise<OrganisationUser | null> =>
              Promise.resolve(user),
          },
        },
      ],
    });
    TestBed.inject(Settings).setActiveConnection('claude');
    projects = TestBed.inject(ForgeProjects);
    organisations = TestBed.inject(MissionControlOrganisations);
    fixture = TestBed.createComponent(MissionControlTeam);
    team = fixture.componentInstance as unknown as TeamInternals;
    fixture.detectChanges();
  });

  /**
   * Opens the project and renders its team.
   * @returns Returns the project.
   */
  async function open(): Promise<ForgeProject> {
    projects.publish(STUDIO, '/dev/studio', 'tab-1');
    TestBed.tick();
    await settle();
    fixture.detectChanges();
    return projects.projects()[0];
  }

  /**
   * Gets the host element.
   * @returns Returns it.
   */
  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  /**
   * Gets the names on the roster, as rendered.
   * @returns Returns the names.
   */
  function names(): string[] {
    return [...host().querySelectorAll<HTMLElement>('.mct__name')].map(
      (element: HTMLElement): string => element.textContent?.trim() ?? '',
    );
  }

  /**
   * Finds a rendered button by its label.
   * @param label The label.
   * @returns Returns the button.
   */
  function button(label: string): HTMLButtonElement {
    return [...host().querySelectorAll<HTMLButtonElement>('button')].find(
      (element: HTMLButtonElement): boolean => element.textContent?.trim() === label,
    )!;
  }

  it('saysSo_whenNoProjectIsOpen', () => {
    expect(host().textContent).toContain('No projects open');
  });

  it('listsTheTeam_withRoleAssignmentAndPresence', async () => {
    await open();

    expect(names()).toEqual(['Ada Lovelace']);
    expect(host().querySelector('.mct__role')?.textContent?.trim()).toBe('Engineer');
    expect(host().querySelector('.mct__assignment')?.textContent?.trim()).toBe('Unassigned');
    expect(host().querySelector('.mct__presence')?.textContent?.trim()).toBe('Away');
  });

  it('hiresFromTheForm_andClearsTheName', async () => {
    await open();
    expect(button('Hire').disabled).toBe(true);
    const field: HTMLInputElement = host().querySelector<HTMLInputElement>('.mct__hire input')!;

    field.value = 'Grace Hopper';
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    button('Hire').click();
    fixture.detectChanges();

    expect(names()).toEqual(['Ada Lovelace', 'Grace Hopper']);
    expect(field.value).toBe('');
  });

  it('movesRoles_unassigns_andLetsGo_fromTheMenu', async () => {
    const project: ForgeProject = await open();
    const row: ListRow = team.rowsFor(project)[0];
    organisations.assign(project, 'ada', 795);

    expect(
      team
        .menuFor(team.rowsFor(project)[0])
        .find((item: MenuItem): boolean => item.id === 'unassign')?.disabled,
    ).toBe(false);
    team.onMenu({ itemId: 'role:reviewer', row });
    team.onMenu({ itemId: 'unassign', row });

    expect(organisations.stateFor(project.key).organisation.agents[0].roleId).toBe('reviewer');
    expect(organisations.agentState(project.key, 'ada').workItem).toBeNull();

    team.onMenu({ itemId: 'remove', row });
    fixture.detectChanges();
    expect(names()).toEqual([]);
    expect(host().textContent).toContain('Nobody on the team yet');
  });

  it('renamesInPlace', async () => {
    const project: ForgeProject = await open();
    const row: ListRow = team.rowsFor(project)[0];

    team.onMenu({ itemId: 'rename', row });
    expect(team.editingId()).toBe(row.id);
    team.onRename({ row, value: 'Countess Lovelace' });

    expect(team.editingId()).toBeNull();
    expect(organisations.stateFor(project.key).organisation.agents[0].name).toBe(
      'Countess Lovelace',
    );
  });

  it('opensAChat_byHostingTheAgentAndRevealingItsColumn', async () => {
    const project: ForgeProject = await open();

    team.onMenu({ itemId: 'chat', row: team.rowsFor(project)[0] });

    const agent: OrganisationAgent = organisations.stateFor(project.key).organisation.agents[0];
    const hosted: HostedOrgAgent | undefined = TestBed.inject(MissionControlOrgAgents).hostFor(
      project.key,
      agent.id,
    );
    const tile: AgentHost | undefined = TestBed.inject(AgentHosts)
      .hosts()
      .find((candidate: AgentHost): boolean => candidate.agent === hosted?.agent);
    expect(tile).toBeDefined();
    expect(TestBed.inject(MissionControl).face()).toBe('agents');
    expect(TestBed.inject(MissionControl).revealRequest()).toBe(tile?.id);
  });
});
