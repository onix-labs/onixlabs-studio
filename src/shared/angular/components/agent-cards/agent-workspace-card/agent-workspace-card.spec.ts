import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FakeProjectMachine } from '@features/welcome/angular/welcome-create/project-draft.testing';
import type { AgentItem } from '@shared/angular/services/agent/agent';
import { WorkspaceProposals } from '@shared/angular/services/workspace-proposals/workspace-proposals';
import { AgentWorkspaceCard } from './agent-workspace-card';

describe('AgentWorkspaceCard', () => {
  const PROPOSAL: AgentItem = {
    id: 'item-7',
    kind: 'workspace-proposal',
    text: '',
    proposalName: 'todo-app',
    proposalSummary: 'A list that remembers.',
    proposalHandoff: '# Plan\n\nThe list first.',
    proposalState: 'pending',
  };

  let created: unknown[][];

  /**
   * Renders the card, letting it read what the machine offers.
   * @param item The proposal.
   * @param withProposals Whether the card is shown in its agent tab.
   * @returns Returns the fixture.
   */
  async function render(
    item: AgentItem,
    withProposals: boolean = true,
  ): Promise<ComponentFixture<AgentWorkspaceCard>> {
    TestBed.configureTestingModule({
      providers: [
        ...new FakeProjectMachine().providers(),
        ...(withProposals
          ? [
              {
                provide: WorkspaceProposals,
                useValue: {
                  create: (...args: unknown[]): Promise<null> => {
                    created.push(args);
                    return Promise.resolve(null);
                  },
                  dismiss: (): void => undefined,
                },
              },
            ]
          : []),
      ],
    });
    const fixture: ComponentFixture<AgentWorkspaceCard> =
      TestBed.createComponent(AgentWorkspaceCard);
    fixture.componentRef.setInput('item', item);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  /**
   * Finds a button by its label.
   * @param fixture The fixture.
   * @param label The label.
   * @returns Returns the button.
   */
  function button(fixture: ComponentFixture<unknown>, label: string): HTMLButtonElement {
    return [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find(
      (candidate: HTMLButtonElement): boolean => candidate.textContent?.trim() === label,
    )!;
  }

  beforeEach(() => {
    created = [];
  });

  it('startsWithTheNameTheAgentSuggested_andSaysWhereItGoes', async () => {
    const fixture: ComponentFixture<AgentWorkspaceCard> = await render(PROPOSAL);
    const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Create the workspace');
    expect(text).toContain('A list that remembers.');
    expect(text).toContain('/Users/me/Development/todo-app');
    expect(button(fixture, 'Create').disabled).toBe(false);
  });

  it('create_handsTheProposalAndItsDetailsToTheTab', async () => {
    const fixture: ComponentFixture<AgentWorkspaceCard> = await render(PROPOSAL);

    button(fixture, 'Create').click();
    await fixture.whenStable();

    expect(created).toHaveLength(1);
    expect(created[0][0]).toBe(PROPOSAL);
  });

  it('cannotCreate_whereItIsNotInItsAgentTab', async () => {
    const fixture: ComponentFixture<AgentWorkspaceCard> = await render(PROPOSAL, false);

    expect(button(fixture, 'Create').disabled).toBe(true);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Open this conversation in its agent tab',
    );
  });

  it('saysWhereItWasMade_onceCreated', async () => {
    const fixture: ComponentFixture<AgentWorkspaceCard> = await render({
      ...PROPOSAL,
      proposalState: 'created',
      proposalPath: '/Users/me/Development/todo-app',
    });

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Created at /Users/me/Development/todo-app',
    );
    expect(button(fixture, 'Create')).toBeUndefined();
  });
});
