import { TestBed } from '@angular/core/testing';
import type { StoredAgentConversation } from '@shared/api/agent-conversation-channels';
import { FakeProjectMachine } from '@features/welcome/angular/welcome-create/project-draft.testing';
import { Agent, AgentItem } from '@shared/angular/services/agent/agent';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import { AgentConversations } from '@shared/angular/services/agent-conversations/agent-conversations';
import { ProjectDestination } from '@shared/angular/services/new-project/project-destination';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { WorkspaceProposals } from './workspace-proposals';

describe('WorkspaceProposals', () => {
  const PROPOSAL: AgentItem = {
    id: 'item-7',
    kind: 'workspace-proposal',
    text: '',
    proposalName: 'todo-app',
    proposalHandoff: '# Plan\n\nThe list first.',
    proposalState: 'pending',
  };

  let machine: FakeProjectMachine;
  let settled: unknown[][];
  let saved: StoredAgentConversation[];
  let closed: string[];
  let proposals: WorkspaceProposals;
  let destination: ProjectDestination;

  beforeEach(async () => {
    machine = new FakeProjectMachine();
    settled = [];
    saved = [];
    closed = [];
    TestBed.configureTestingModule({
      providers: [
        ...machine.providers(),
        WorkspaceProposals,
        {
          provide: Agent,
          useValue: {
            settleProposal: (...args: unknown[]): number => settled.push(args),
          },
        },
        {
          provide: AgentConversation,
          useValue: { flush: (): Promise<string | null> => Promise.resolve('c1') },
        },
        {
          provide: AgentConversations,
          useValue: {
            load: (): Promise<StoredAgentConversation> =>
              Promise.resolve({
                id: 'c1',
                contextId: 'global:',
                title: 'Plan a todo app',
                provider: 'claude',
                model: 'm',
                createdAt: 1,
                updatedAt: 2,
                messageCount: 4,
                items: [],
              }),
            save: (record: StoredAgentConversation): Promise<null> => {
              saved.push(record);
              return Promise.resolve(null);
            },
          },
        },
        { provide: Tabs, useValue: { close: (id: string): number => closed.push(id) } },
      ],
    });
    proposals = TestBed.inject(WorkspaceProposals);
    proposals.bind('tab-3');
    destination = TestBed.runInInjectionContext((): ProjectDestination => new ProjectDestination());
    destination.initialise();
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
    destination.name.set('todo-app');
  });

  it('create_makesTheProjectWithTheHandoff_movesTheConversation_opensIt_andClosesTheTab', async () => {
    const problem: string | null = await proposals.create(PROPOSAL, destination);

    expect(problem).toBeNull();
    expect(machine.created).toEqual([
      { name: 'todo-app', repository: { kind: 'none' }, handoff: '# Plan\n\nThe list first.' },
    ]);
    expect(settled).toEqual([[PROPOSAL, 'created', '/Users/me/Development/todo-app']]);
    // Filed under the new workspace, so History lists it there.
    expect(saved).toEqual([
      expect.objectContaining({
        id: 'c1',
        contextId: 'workspace:/Users/me/Development/todo-app',
        agentType: 'workspace',
        contextLabel: 'todo-app',
      }),
    ]);
    expect(machine.opened[0].path).toBe('/Users/me/Development/todo-app');
    expect(machine.opened[0].start?.prompt).toContain('Read handoff.md first');
    expect(machine.opened[0].start?.brief).toContain('handoff.md');
    expect(closed).toEqual(['tab-3']);
  });

  it('create_whenTheProjectCannotBeMade_saysWhy_andChangesNothing', async () => {
    machine.outcome = { ok: false, error: '/Users/me/Development/todo-app already exists.' };

    const problem: string | null = await proposals.create(PROPOSAL, destination);

    expect(problem).toContain('already exists');
    expect(settled).toEqual([]);
    expect(saved).toEqual([]);
    expect(machine.opened).toEqual([]);
    expect(closed).toEqual([]);
  });

  it('create_withDetailsMissing_makesNothing', async () => {
    destination.setRepository('local');

    expect(await proposals.create(PROPOSAL, destination)).toBe(
      'Choose how the repository is laid out.',
    );
    expect(machine.created).toEqual([]);
  });

  it('dismiss_putsTheProposalAside', () => {
    proposals.dismiss(PROPOSAL);

    expect(settled).toEqual([[PROPOSAL, 'dismissed']]);
  });
});
