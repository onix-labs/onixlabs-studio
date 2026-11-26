import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AiChannel } from '@shared/api/ai-channels';
import type { Bridge } from '@shared/api/bridge';
import type { PersonaEntry } from '@shared/api/persona-channels';
import {
  PersonaLearningChannel,
  type PersonaSnapshot,
  type LearningState,
} from '@shared/api/persona-learning-protocol';
import { PersonaLearning } from '@shared/angular/services/persona/persona-learning';
import { Settings } from '@shared/angular/services/settings/settings';
import { PersonaActivity } from './persona-activity';

/**
 * Builds an entry.
 * @param id The id.
 * @returns Returns the entry.
 */
function entry(id: string): PersonaEntry {
  return {
    id,
    name: `Entry ${id}`,
    text: 'x',
    why: '',
    tags: [],
    links: [],
    scope: { surfaces: [], languages: [] },
    layer: 'memory',
    enabled: true,
    confidence: 0.5,
    confirmed: '',
    author: 'learned',
    locked: false,
  };
}

describe('PersonaActivity (#1516)', () => {
  let fixture: ComponentFixture<PersonaActivity>;
  let calls: [string, unknown][];
  let state: LearningState;
  let snapshots: readonly PersonaSnapshot[];

  beforeEach(async () => {
    localStorage.clear();
    calls = [];
    snapshots = [];
    state = {
      recent: [
        {
          id: 'ch1',
          at: Date.now(),
          kind: 'add',
          entryId: 'one',
          before: null,
          after: entry('one'),
          reason: '',
        },
      ],
      pending: [],
      ruledOut: ['health'],
      questions: [],
      lastRun: 0,
      rebuild: null,
    };
    const bridge: Partial<Bridge> = {
      invoke: <T>(channel: string, arg?: unknown): Promise<T> => {
        calls.push([channel, arg]);
        // The model picker lists the providers, so that read answers with a list like the rest.
        return Promise.resolve(
          (channel === (PersonaLearningChannel.State as string)
            ? state
            : channel === (PersonaLearningChannel.ListSnapshots as string)
              ? snapshots
              : channel === (AiChannel.ListProviders as string)
                ? []
                : true) as T,
        );
      },
      on: (): (() => void) => (): void => undefined,
    };
    (window as unknown as { bridge?: Partial<Bridge> }).bridge = bridge;
    fixture = TestBed.createComponent(PersonaActivity);
    await fixture.whenStable();
  });

  afterEach(() => {
    delete (window as unknown as { bridge?: Bridge }).bridge;
  });

  /**
   * Gets the rendered root.
   * @returns Returns the element.
   */
  function element(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  it('saysLearningIsOff_untilAConnectionIsChosen', async () => {
    expect(element().querySelector('[data-testid="learning-status"]')?.textContent).toContain(
      'Persona learning is off',
    );

    TestBed.inject(Settings).set('persona.learningConnectionId', 'local');
    await fixture.whenStable();

    expect(element().querySelector('[data-testid="learning-status"]')?.textContent).toContain(
      'Persona learning is on',
    );
  });

  it('listsRecentChanges_eachWithUndo', () => {
    const rows: HTMLElement[] = [
      ...element().querySelectorAll<HTMLElement>('[data-testid="learning-recent"] li'),
    ];

    expect(
      rows.map(
        (row: HTMLElement): string =>
          row
            .querySelector('.activity__text')
            ?.textContent?.replace(/[\s\u00a0]+/g, ' ')
            .trim() ?? '',
      ),
    ).toEqual(['Added Entry one · just now']);

    rows[0].querySelector('button')?.click();

    expect(calls).toContainEqual([PersonaLearningChannel.Undo, 'ch1']);
  });

  it('rulesOutATopic_andLetsOneBackIn', async () => {
    const component: { topicDraft: { set(value: string): void }; addTopic(): Promise<void> } =
      fixture.componentInstance as never;
    component.topicDraft.set('Politics');
    await component.addTopic();

    expect(calls).toContainEqual([PersonaLearningChannel.RuleOut, ['health', 'Politics']]);

    element()
      .querySelector<HTMLButtonElement>('[data-testid="learning-ruled-out"] button')
      ?.click();

    expect(calls).toContainEqual([PersonaLearningChannel.RuleOut, []]);
  });

  it('showsARebuildUnderWay_withCancel', async () => {
    state = {
      ...state,
      rebuild: {
        mode: 'fresh',
        connectionId: 'c',
        model: '',
        startedAt: 0,
        total: 40,
        done: ['a', 'b'],
      },
    };
    await TestBed.inject(PersonaLearning).refresh();
    await fixture.whenStable();

    const progress: HTMLElement | null = element().querySelector(
      '[data-testid="learning-rebuild"]',
    );
    expect(progress?.textContent?.replace(/\s+/g, ' ')).toContain(
      'Building your persona afresh: 2 of 40 conversations read.',
    );

    progress?.querySelector('button')?.click();
    await fixture.whenStable();

    expect(calls).toContainEqual([PersonaLearningChannel.CancelRebuild, undefined]);
  });

  it('listsEarlierCopies_eachWithRestore', async () => {
    snapshots = [
      { id: '2026-11-19T12-00-00-000Z', takenAt: Date.parse('2026-11-19T12:00:00Z'), entries: 7 },
    ];
    // A fresh copy of the records, as each read over the bridge is.
    state = { ...state };
    await TestBed.inject(PersonaLearning).refresh();
    await fixture.whenStable();
    await fixture.whenStable();

    const rows: HTMLElement[] = [
      ...element().querySelectorAll<HTMLElement>('[data-testid="learning-snapshots"] li'),
    ];
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('7 entries');

    rows[0].querySelector('button')?.click();

    expect(calls).toContainEqual([
      PersonaLearningChannel.RestoreSnapshot,
      '2026-11-19T12-00-00-000Z',
    ]);
  });

  it('listsOpenQuestions_andAnswersOrDismissesThem', async () => {
    state = {
      ...state,
      questions: [
        { id: 'q1', text: 'Why do you avoid flying?', asked: 0 },
        { id: 'q2', text: 'Window or aisle?', asked: 0 },
      ],
    };
    await TestBed.inject(PersonaLearning).refresh();
    await fixture.whenStable();
    const items: HTMLElement[] = [
      ...element().querySelectorAll<HTMLElement>('[data-testid="learning-questions"] li'),
    ];
    expect(
      items.map(
        (item: HTMLElement): string =>
          item.querySelector('.activity__text')?.textContent?.trim() ?? '',
      ),
    ).toEqual(['Why do you avoid flying?', 'Window or aisle?']);

    const field: HTMLInputElement | null = items[0].querySelector('input');
    if (field !== null) {
      field.value = 'The carbon cost.';
      field.dispatchEvent(new Event('input'));
    }
    [...items[0].querySelectorAll<HTMLButtonElement>('button')]
      .find((button: HTMLButtonElement): boolean => button.textContent?.trim() === 'Answer')
      ?.click();
    await fixture.whenStable();
    [...items[1].querySelectorAll<HTMLButtonElement>('button')]
      .find((button: HTMLButtonElement): boolean => button.textContent?.trim() === 'Dismiss')
      ?.click();
    await fixture.whenStable();

    expect(calls).toContainEqual([
      PersonaLearningChannel.AnswerQuestion,
      { questionId: 'q1', answer: 'The carbon cost.' },
    ]);
    expect(calls).toContainEqual([
      PersonaLearningChannel.AnswerQuestion,
      { questionId: 'q2', answer: '' },
    ]);
  });
});
