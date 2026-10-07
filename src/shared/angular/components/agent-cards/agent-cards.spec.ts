import type { Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { AiEditDecision } from '@shared/api/ai-types';
import type { AgentItem } from '@shared/angular/services/agent/agent';
import { AgentEditDecisionCard } from './agent-edit-decision-card/agent-edit-decision-card';
import { AgentErrorCard } from './agent-error-card/agent-error-card';
import {
  AgentPermissionCard,
  PermissionAnswer,
} from './agent-permission-card/agent-permission-card';
import { AgentQuestionCard } from './agent-question-card/agent-question-card';

/**
 * Renders a card for an item.
 * @param type The card component.
 * @param item The item.
 * @returns Returns the fixture.
 */
function render<T>(type: Type<T>, item: AgentItem): ComponentFixture<T> {
  const fixture: ComponentFixture<T> = TestBed.createComponent(type);
  fixture.componentRef.setInput('item', item);
  fixture.detectChanges();
  return fixture;
}

/**
 * Reads a card's text, whitespace collapsed.
 * @param fixture The fixture.
 * @returns Returns the text.
 */
function text(fixture: ComponentFixture<unknown>): string {
  return ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ').trim();
}

describe('AgentQuestionCard', () => {
  const question: AgentItem = {
    id: 'item-2',
    kind: 'input-request',
    text: '',
    inputQuestion: 'Which approach?',
    inputChoices: [{ label: 'A' }, { label: 'B', description: 'the bold one' }],
    inputState: 'pending',
  };

  it('answersWithTheSelectedChoice_onlyOnceConfirmed', () => {
    const fixture: ComponentFixture<AgentQuestionCard> = render(AgentQuestionCard, question);
    const answers: (string | null)[] = [];
    fixture.componentInstance.answer.subscribe((answer: string | null): number =>
      answers.push(answer),
    );

    fixture.componentInstance.confirm();
    fixture.componentInstance.select('B');
    fixture.componentInstance.confirm();

    expect(answers).toEqual(['B']);
  });

  it('skipping_answersNull', () => {
    const fixture: ComponentFixture<AgentQuestionCard> = render(AgentQuestionCard, question);
    const answers: (string | null)[] = [];
    fixture.componentInstance.answer.subscribe((answer: string | null): number =>
      answers.push(answer),
    );

    const buttons: NodeListOf<HTMLButtonElement> = (
      fixture.nativeElement as HTMLElement
    ).querySelectorAll('app-button button');
    buttons[buttons.length - 1].click();

    expect(answers).toEqual([null]);
  });

  it('showsTheAnswer_onceAnswered', () => {
    const fixture: ComponentFixture<AgentQuestionCard> = render(AgentQuestionCard, {
      ...question,
      inputState: 'answered',
      inputAnswer: 'B',
    });

    expect(text(fixture)).toBe('Which approach?B');
  });
});

describe('AgentPermissionCard', () => {
  const permission: AgentItem = {
    id: 'item-9',
    kind: 'permission',
    text: '',
    permissionName: 'Bash',
    permissionState: 'pending',
    permissionHasWorkspace: true,
  };

  it('carriesTheRememberScope_onBothAnswers', () => {
    const fixture: ComponentFixture<AgentPermissionCard> = render(AgentPermissionCard, permission);
    const answers: PermissionAnswer[] = [];
    fixture.componentInstance.respond.subscribe((answer: PermissionAnswer): number =>
      answers.push(answer),
    );

    fixture.componentInstance.answer(true);
    fixture.componentInstance.setRemember('session');
    fixture.componentInstance.answer(true);
    fixture.componentInstance.answer(false);

    expect(answers).toEqual([
      { granted: true },
      { granted: true, remember: 'session' },
      { granted: false, remember: 'session' },
    ]);
  });

  it('offersTheWorkspaceScope_onlyForAWorkspaceRun', () => {
    const options: (item: AgentItem) => string = (item: AgentItem): string =>
      (render(AgentPermissionCard, item).nativeElement as HTMLElement).querySelector('app-dropdown')
        ?.textContent ?? '';

    expect(options(permission)).toContain('For this workspace');
    expect(options({ ...permission, permissionHasWorkspace: false })).not.toContain(
      'For this workspace',
    );
  });

  it('saysHowItWasSettled', () => {
    const settled: (patch: Partial<AgentItem>) => string = (patch: Partial<AgentItem>): string =>
      text(render(AgentPermissionCard, { ...permission, ...patch })).replace('Allow Bash? ', '');

    expect(settled({ permissionState: 'allowed', permissionRemember: 'workspace' })).toBe(
      'Allowed for this workspace',
    );
    expect(settled({ permissionState: 'denied' })).toBe('Denied');
    expect(settled({ permissionState: 'dismissed' })).toBe('Answered on another device');
  });
});

describe('AgentEditDecisionCard', () => {
  it('decidesOnTheChosenRow', () => {
    const fixture: ComponentFixture<AgentEditDecisionCard> = render(AgentEditDecisionCard, {
      id: 'item-1',
      kind: 'edit-decision',
      text: '',
      decisionName: 'the active document',
      decisionState: 'pending',
    });
    const decisions: AiEditDecision[] = [];
    fixture.componentInstance.decide.subscribe((choice: AiEditDecision): number =>
      decisions.push(choice),
    );

    (fixture.nativeElement as HTMLElement)
      .querySelectorAll<HTMLInputElement>('input[type="radio"]')[2]
      .click();

    expect(decisions).toEqual(['no']);
  });

  it('saysHowItWasSettled', () => {
    expect(
      text(
        render(AgentEditDecisionCard, {
          id: 'item-1',
          kind: 'edit-decision',
          text: '',
          decisionName: 'notes.md',
          decisionState: 'applied',
          decisionAuto: true,
        }),
      ),
    ).toBe('Apply this edit to notes.md? Applied · auto-accepting edits this session');
  });
});

describe('AgentErrorCard', () => {
  it('holdsRetryBack_whileATurnRuns', () => {
    const fixture: ComponentFixture<AgentErrorCard> = render(AgentErrorCard, {
      id: 'item-1',
      kind: 'error',
      text: 'boom',
      errorPrompt: 'do the thing',
    });
    fixture.componentRef.setInput('busy', true);
    fixture.detectChanges();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('app-button button')
        ?.disabled,
    ).toBe(true);
  });
});
