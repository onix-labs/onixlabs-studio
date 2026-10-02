import { TestBed } from '@angular/core/testing';

import { AgentHost, AgentHosts } from '@shared/angular/services/agent-hosts/agent-hosts';
import { AiRuntime, AiRunOptions } from '@shared/angular/services/ai-runtime/ai-runtime';
import {
  ForgeProject,
  ForgeProjects,
} from '@shared/angular/services/forge-projects/forge-projects';
import { OrganisationFiles } from '@shared/angular/services/organisation-files/organisation-files';
import { Settings } from '@shared/angular/services/settings/settings';
import { ForgeRepositoryRef } from '@shared/api/forge-types';
import {
  BUILT_IN_ROLES,
  Organisation,
  OrganisationAgent,
  OrganisationRole,
  OrganisationUser,
  parseOrganisation,
  parseOrganisationUser,
} from '@shared/api/organisation';
import { OrganisationSnapshot } from '@shared/api/organisation-channels';
import { composeBrief, HostedOrgAgent, MissionControlOrgAgents } from './org-agents';
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
 * Lets queued promises settle.
 */
async function settle(): Promise<void> {
  for (let turn: number = 0; turn < 10; turn++) {
    await Promise.resolve();
  }
}

describe('composeBrief', () => {
  const ada: OrganisationAgent = { id: 'ada', name: 'Ada', roleId: 'engineer' };
  const engineer: OrganisationRole | undefined = BUILT_IN_ROLES.find(
    (role: OrganisationRole): boolean => role.id === 'engineer',
  );

  it('saysWhoTheAgentIs_itsJob_andItsAssignment', () => {
    expect(composeBrief(ada, engineer, 795)).toBe(
      [
        "Your name is Ada. You hold the Engineer role in this project's agent organisation.",
        engineer?.brief,
        'You are assigned to issue #795 in this repository.',
      ].join('\n\n'),
    );
  });

  it('saysSo_whenThereIsNoAssignmentOrRole', () => {
    expect(composeBrief(ada, undefined, null)).toBe(
      [
        "Your name is Ada. You hold the unassigned role in this project's agent organisation.",
        'You have no work item assigned yet.',
      ].join('\n\n'),
    );
  });
});

describe('MissionControlOrgAgents', () => {
  let runs: AiRunOptions[];
  let orgAgents: MissionControlOrgAgents;
  let organisations: MissionControlOrganisations;
  let projects: ForgeProjects;
  let project: ForgeProject;
  let withdraw: () => void;
  let stored: { organisation: Organisation; user: OrganisationUser };

  beforeEach(async () => {
    runs = [];
    stored = { organisation: parseOrganisation(null), user: parseOrganisationUser(null) };
    const runtimeStub: Partial<AiRuntime> = {
      onEvent: (): (() => void) => (): void => undefined,
      listProviders: () => Promise.resolve([]),
      checkClaudeAuth: (): Promise<boolean> => Promise.resolve(true),
      closeSession: (): void => undefined,
      stopAgent: (): void => undefined,
      abort: (): void => undefined,
      run: (_provider: string, _prompt: string, options: AiRunOptions = {}): string => {
        runs.push(options);
        return `run-${runs.length}`;
      },
    };
    const filesStub: Partial<OrganisationFiles> = {
      load: (): Promise<OrganisationSnapshot | null> => Promise.resolve(stored),
      save: (_root: string, organisation: Organisation): Promise<Organisation | null> => {
        stored = { ...stored, organisation: parseOrganisation(organisation) };
        return Promise.resolve(stored.organisation);
      },
      saveUser: (_root: string, user: OrganisationUser): Promise<OrganisationUser | null> => {
        stored = { ...stored, user: parseOrganisationUser(user) };
        return Promise.resolve(stored.user);
      },
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: AiRuntime, useValue: runtimeStub },
        { provide: OrganisationFiles, useValue: filesStub },
      ],
    });
    TestBed.inject(Settings).setActiveConnection('claude');
    projects = TestBed.inject(ForgeProjects);
    organisations = TestBed.inject(MissionControlOrganisations);
    orgAgents = TestBed.inject(MissionControlOrgAgents);
    withdraw = projects.publish(STUDIO, '/dev/studio', 'tab-7');
    TestBed.tick();
    await settle();
    project = projects.projects()[0];
  });

  /**
   * Hires an agent and hosts it.
   * @param name The agent's name.
   * @param roleId The role it holds.
   * @returns Returns the agent and its host.
   */
  function hire(
    name: string,
    roleId: string,
  ): { agent: OrganisationAgent; hosted: HostedOrgAgent } {
    const agent: OrganisationAgent = organisations.addAgent(project, name, roleId)!;
    return { agent, hosted: orgAgents.open(project, agent) };
  }

  it('hostsANamedAgent_inMissionControl', () => {
    const { hosted } = hire('Ada', 'engineer');

    const host: AgentHost | undefined = TestBed.inject(AgentHosts)
      .hosts()
      .find((candidate: AgentHost): boolean => candidate.agent === hosted.agent);
    expect(host?.label()).toBe('Ada · Engineer');
    expect(host?.surface).toBe('workspace');
  });

  it('returnsTheSameHost_whenOpenedTwice', () => {
    const { agent, hosted } = hire('Ada', 'engineer');

    expect(orgAgents.open(project, agent)).toBe(hosted);
    expect(orgAgents.hosted()).toHaveLength(1);
  });

  it('runsInTheProjectsWorkspace_carryingItsBrief', () => {
    const { agent, hosted } = hire('Ada', 'engineer');
    organisations.assign(project, agent.id, 795);

    hosted.agent.send('Start on it.');

    expect(runs[0].workspaceRoot).toBe('/dev/studio');
    expect(runs[0].owningTabId).toBe('tab-7');
    expect(runs[0].systemPromptExtra).toContain('Your name is Ada.');
    expect(runs[0].systemPromptExtra).toContain('You are assigned to issue #795');
  });

  it('startsAReadOnlyRole_inChatMode', () => {
    expect(hire('Grace', 'qa').hosted.agent.mode()).toBe('chat');
    expect(hire('Linus', 'engineer').hosted.agent.mode()).toBe('agent');
  });

  it('followsARename_inItsLabel', () => {
    const { agent, hosted } = hire('Ada', 'engineer');

    organisations.rename(project, agent.id, 'Ada Lovelace');

    const host: AgentHost | undefined = TestBed.inject(AgentHosts)
      .hosts()
      .find((candidate: AgentHost): boolean => candidate.agent === hosted.agent);
    expect(host?.label()).toBe('Ada Lovelace · Engineer');
  });

  it('letsTheAgentGo_whenItLeavesTheRoster', async () => {
    const { agent } = hire('Ada', 'engineer');

    organisations.remove(project, agent.id);
    TestBed.tick();
    await settle();

    expect(orgAgents.hosted()).toEqual([]);
    expect(TestBed.inject(AgentHosts).hosts()).toEqual([]);
  });

  it('letsEveryAgentGo_whenTheProjectCloses', () => {
    hire('Ada', 'engineer');
    hire('Grace', 'tester');

    withdraw();
    TestBed.tick();

    expect(orgAgents.hosted()).toEqual([]);
  });

  it('closeIsANoOp_forAnAgentNotHosted', () => {
    expect((): void => orgAgents.close('nope', 'nobody')).not.toThrow();
  });
});
