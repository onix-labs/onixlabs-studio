import { TestBed } from '@angular/core/testing';

import {
  ForgeProject,
  ForgeProjects,
  projectKey,
} from '@shared/angular/services/forge-projects/forge-projects';
import { OrganisationFiles } from '@shared/angular/services/organisation-files/organisation-files';
import {
  BUILT_IN_ROLES,
  Organisation,
  OrganisationAgent,
  OrganisationUser,
  parseOrganisation,
  parseOrganisationUser,
} from '@shared/api/organisation';
import { OrganisationSnapshot } from '@shared/api/organisation-channels';
import { ForgeRepositoryRef } from '@shared/api/forge-types';
import { MissionControlOrganisations } from './organisations';

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
 * The project's key.
 */
const KEY: string = projectKey(STUDIO);

/**
 * Organisation files kept in memory, answering as the main process would: parsed on the way in.
 */
class FakeFiles {
  public organisation: Organisation = parseOrganisation(null);
  public user: OrganisationUser = parseOrganisationUser(null);
  public readonly saves: string[] = [];
  public open: boolean = true;

  public load(): Promise<OrganisationSnapshot | null> {
    return Promise.resolve(this.open ? { organisation: this.organisation, user: this.user } : null);
  }

  public save(_root: string, organisation: Organisation): Promise<Organisation | null> {
    this.saves.push(`roster:${organisation.agents.map((agent) => agent.name).join(',')}`);
    this.organisation = parseOrganisation(organisation);
    return Promise.resolve(this.open ? this.organisation : null);
  }

  public saveUser(_root: string, user: OrganisationUser): Promise<OrganisationUser | null> {
    this.saves.push(`user:${JSON.stringify(user.agents)}`);
    this.user = parseOrganisationUser(user);
    return Promise.resolve(this.open ? this.user : null);
  }
}

/**
 * Lets queued promises settle.
 */
async function settle(): Promise<void> {
  for (let turn: number = 0; turn < 10; turn++) {
    await Promise.resolve();
  }
}

describe('MissionControlOrganisations', () => {
  let files: FakeFiles;
  let projects: ForgeProjects;
  let organisations: MissionControlOrganisations;
  let project: ForgeProject;
  let withdraw: () => void;

  beforeEach(async () => {
    files = new FakeFiles();
    TestBed.configureTestingModule({
      providers: [{ provide: OrganisationFiles, useValue: files }],
    });
    projects = TestBed.inject(ForgeProjects);
    organisations = TestBed.inject(MissionControlOrganisations);
    withdraw = projects.publish(STUDIO, '/dev/studio', 'tab-1');
    TestBed.tick();
    await settle();
    project = projects.projects()[0];
  });

  /**
   * Gets the roster's names.
   * @returns Returns the names, in order.
   */
  function names(): readonly string[] {
    return organisations
      .stateFor(KEY)
      .organisation.agents.map((agent: OrganisationAgent): string => agent.name);
  }

  it('readsAProjectsOrganisation_asSoonAsItOpens', () => {
    expect(organisations.stateFor(KEY).loaded).toBe(true);
    expect(organisations.stateFor(KEY).organisation.roles).toEqual(BUILT_IN_ROLES);
  });

  it('reportsAnUnreadProject_withTheBuiltInRolesAndNobody', () => {
    expect(organisations.stateFor('github:elsewhere')).toMatchObject({
      loaded: false,
      organisation: { roles: BUILT_IN_ROLES, agents: [] },
    });
  });

  it('hiresAnAgent_atOnce_andWritesTheRoster', async () => {
    const ada: OrganisationAgent | null = organisations.addAgent(project, '  Ada  ', 'engineer');

    expect(ada?.name).toBe('Ada');
    expect(names()).toEqual(['Ada']);
    await settle();
    expect(files.saves).toEqual(['roster:Ada']);
    expect(files.organisation.agents[0].id).toBe(ada?.id);
  });

  it('refusesABlankName_anUnknownRole_andAFullRoster', () => {
    expect(organisations.addAgent(project, '   ', 'engineer')).toBeNull();
    expect(organisations.addAgent(project, 'Ada', 'astronaut')).toBeNull();
    for (let index: number = 0; index < 32; index++) {
      organisations.addAgent(project, `Agent ${index}`, 'engineer');
    }
    expect(organisations.addAgent(project, 'One too many', 'engineer')).toBeNull();
  });

  it('renamesAndMovesRoles_ignoringBlankNamesAndUnknownRoles', () => {
    const ada: OrganisationAgent = organisations.addAgent(project, 'Ada', 'engineer')!;

    organisations.rename(project, ada.id, 'Ada Lovelace');
    organisations.rename(project, ada.id, '  ');
    organisations.setRole(project, ada.id, 'reviewer');
    organisations.setRole(project, ada.id, 'astronaut');

    expect(organisations.stateFor(KEY).organisation.agents).toEqual([
      { id: ada.id, name: 'Ada Lovelace', roleId: 'reviewer' },
    ]);
  });

  it('assignsAnAgent_movingItOffItsLastWorkItem', () => {
    const ada: OrganisationAgent = organisations.addAgent(project, 'Ada', 'engineer')!;

    organisations.assign(project, ada.id, 795);
    expect(organisations.assignedTo(KEY, 795)).toEqual([ada]);

    organisations.assign(project, ada.id, 796);
    expect(organisations.assignedTo(KEY, 795)).toEqual([]);
    expect(organisations.agentState(KEY, ada.id).workItem).toBe(796);

    organisations.assign(project, ada.id, null);
    expect(organisations.stateFor(KEY).user.agents).toEqual([]);
  });

  it('remembersTheConversation_onlyWhenItChanges', async () => {
    const ada: OrganisationAgent = organisations.addAgent(project, 'Ada', 'engineer')!;
    await settle();
    files.saves.length = 0;
    const conversation: string = '3f2b9c1e-6a7d-4e1f-9b2a-0c5d8e7f6a1b';

    organisations.rememberConversation(project, ada.id, conversation);
    organisations.rememberConversation(project, ada.id, conversation);
    await settle();

    expect(files.saves).toHaveLength(1);
    expect(organisations.agentState(KEY, ada.id).conversationId).toBe(conversation);
  });

  it('letsAnAgentGo_withItsAssignment', () => {
    const ada: OrganisationAgent = organisations.addAgent(project, 'Ada', 'engineer')!;
    organisations.assign(project, ada.id, 795);

    organisations.remove(project, ada.id);

    expect(names()).toEqual([]);
    expect(organisations.stateFor(KEY).user.agents).toEqual([]);
  });

  it('writesInOrder_andKeepsTheNewestChangeOnScreen', async () => {
    organisations.addAgent(project, 'Ada', 'engineer');
    organisations.addAgent(project, 'Grace', 'tester');

    // The first write's answer arrives while the second change is already applied; it must not wind
    // the roster back to Ada alone.
    await Promise.resolve();
    await Promise.resolve();
    expect(names()).toEqual(['Ada', 'Grace']);

    await settle();
    expect(files.saves).toEqual(['roster:Ada', 'roster:Ada,Grace']);
    expect(names()).toEqual(['Ada', 'Grace']);
  });

  it('keepsTheChange_whenTheWriteIsRefused', async () => {
    files.open = false;

    organisations.addAgent(project, 'Ada', 'engineer');
    await settle();

    expect(names()).toEqual(['Ada']);
  });

  it('forgetsAProjectThatCloses', () => {
    withdraw();
    TestBed.tick();

    expect(organisations.states().has(KEY)).toBe(false);
  });
});
