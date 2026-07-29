import { ComponentFixture, TestBed } from '@angular/core/testing';

import type { AiEditDecision } from '@shared/api/ai-types';
import type { Agent, AgentItem } from '@shared/angular/services/agent/agent';
import { AgentRequestEntry } from '@shared/angular/services/agent-requests/agent-requests';
import { AgentRequestCard } from './agent-request-card';

/**
 * Records the respond calls the card makes on the entry's agent, so a click can be traced to the right
 * answer on the right transcript item.
 */
interface Responses {
  readonly permission: { item: AgentItem; granted: boolean }[];
  readonly edit: { item: AgentItem; choice: AiEditDecision }[];
  readonly input: { item: AgentItem; answer: string | null }[];
}

/**
 * Builds a request entry around a transcript item, with an agent stub that records how it is answered.
 * @param item The pending transcript item (only the fields the card reads need be present).
 * @param responses The recorder the agent stub appends to.
 * @returns Returns the entry.
 */
function makeEntry(item: Partial<AgentItem>, responses: Responses): AgentRequestEntry {
  const fullItem: AgentItem = item as AgentItem;
  const agent: unknown = {
    respondPermission: (target: AgentItem, granted: boolean): void => {
      responses.permission.push({ item: target, granted });
    },
    respondEditDecision: (target: AgentItem, choice: AiEditDecision): void => {
      responses.edit.push({ item: target, choice });
    },
    respondInput: (target: AgentItem, answer: string | null): void => {
      responses.input.push({ item: target, answer });
    },
  };
  return {
    key: 'k1',
    tabId: null,
    label: 'Alpha',
    item: fullItem,
    agent: agent as Agent,
  };
}

/**
 * Gets the card's action buttons, in order. They are `app-button`s, so they are found by their role
 * rather than by a class of their own.
 * @param host The rendered card.
 * @returns Returns the buttons.
 */
function actions(host: HTMLElement): HTMLButtonElement[] {
  return Array.from(host.querySelectorAll<HTMLButtonElement>('.request__actions button'));
}

/**
 * Gets the card's action button carrying the given label.
 * @param host The rendered card.
 * @param label The button's visible label.
 * @returns Returns the button.
 */
function action(host: HTMLElement, label: string): HTMLButtonElement {
  return actions(host).find(
    (button: HTMLButtonElement): boolean => button.textContent?.trim() === label,
  )!;
}

describe('AgentRequestCard', () => {
  let responses: Responses;

  /**
   * Renders the card for the given entry and returns its host element.
   * @param entry The request entry to render.
   * @returns Returns the card's host element.
   */
  async function render(entry: AgentRequestEntry): Promise<HTMLElement> {
    await TestBed.configureTestingModule({ imports: [AgentRequestCard] }).compileComponents();
    const fixture: ComponentFixture<AgentRequestCard> = TestBed.createComponent(AgentRequestCard);
    fixture.componentRef.setInput('entry', entry);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    responses = { permission: [], edit: [], input: [] };
  });

  it('permission_showsTheToolNameAndDetail_andAllowGrantsIt', async () => {
    const entry: AgentRequestEntry = makeEntry(
      { kind: 'permission', permissionName: 'read_file', permissionDetail: 'src/app.ts' },
      responses,
    );
    const host: HTMLElement = await render(entry);

    expect(host.querySelector('.request__heading')?.textContent).toContain('Allow read_file?');
    expect(host.querySelector('.request__detail')?.textContent).toContain('src/app.ts');

    action(host, 'Allow').click();

    expect(responses.permission).toEqual([{ item: entry.item, granted: true }]);
  });

  it('permission_denyDeniesIt', async () => {
    const entry: AgentRequestEntry = makeEntry(
      { kind: 'permission', permissionName: 'run_command' },
      responses,
    );
    const host: HTMLElement = await render(entry);

    // Falls back to a generic tool name when none accompanies the request.
    expect(host.querySelector('.request__heading')?.textContent).toContain('Allow run_command?');
    action(host, 'Deny').click();

    expect(responses.permission).toEqual([{ item: entry.item, granted: false }]);
  });

  it('editDecision_showsTheDocumentName_andYesNoAnswerIt', async () => {
    const entry: AgentRequestEntry = makeEntry(
      { kind: 'edit-decision', decisionName: 'README.md' },
      responses,
    );
    const host: HTMLElement = await render(entry);

    expect(host.querySelector('.request__heading')?.textContent).toContain(
      'Apply an edit to README.md?',
    );

    action(host, 'Yes').click();
    action(host, 'No').click();

    expect(responses.edit).toEqual([
      { item: entry.item, choice: 'yes' },
      { item: entry.item, choice: 'no' },
    ]);
  });

  it('question_rendersEachChoice_andAnswersWithItsLabel', async () => {
    const entry: AgentRequestEntry = makeEntry(
      {
        kind: 'input-request',
        inputQuestion: 'Which environment?',
        inputChoices: [
          { label: 'Staging', description: 'the staging box' },
          { label: 'Production' },
        ],
      },
      responses,
    );
    const host: HTMLElement = await render(entry);

    expect(host.querySelector('.request__heading')?.textContent).toContain('Which environment?');
    // Every action but the trailing Skip, which is always present.
    const buttons: HTMLButtonElement[] = actions(host).slice(0, -1);
    expect(buttons.map((b: HTMLButtonElement): string => b.textContent?.trim() ?? '')).toEqual([
      'Staging',
      'Production',
    ]);

    buttons[1].click(); // Production

    expect(responses.input).toEqual([{ item: entry.item, answer: 'Production' }]);
  });

  it('question_skipDeclinesWithNull', async () => {
    const entry: AgentRequestEntry = makeEntry(
      { kind: 'input-request', inputQuestion: 'Continue?' },
      responses,
    );
    const host: HTMLElement = await render(entry);

    action(host, 'Skip').click();

    expect(responses.input).toEqual([{ item: entry.item, answer: null }]);
  });

  it('question_whenNoQuestionText_fallsBackToADefaultHeading', async () => {
    const entry: AgentRequestEntry = makeEntry({ kind: 'input-request' }, responses);
    const host: HTMLElement = await render(entry);

    expect(host.querySelector('.request__heading')?.textContent).toContain(
      'The agent has a question.',
    );
  });
});
