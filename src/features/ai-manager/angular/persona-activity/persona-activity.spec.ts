import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { Bridge } from '@shared/api/bridge';
import type { PersonaEntry } from '@shared/api/persona-channels';
import { PeteChannel, type PersonaSnapshot, type PeteState } from '@shared/api/pete-protocol';
import { Pete } from '@shared/angular/services/persona/pete';
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
    author: 'pete',
    locked: false,
  };
}

describe('PersonaActivity (#1516)', () => {
  let fixture: ComponentFixture<PersonaActivity>;
  let calls: [string, unknown][];
  let state: PeteState;
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
        return Promise.resolve(
          (channel === (PeteChannel.State as string)
            ? state
            : channel === (PeteChannel.ListSnapshots as string)
              ? snapshots
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

  it('saysPeteIsOff_untilAConnectionIsChosen', async () => {
    expect(element().querySelector('[data-testid="pete-status"]')?.textContent).toContain(
      'Pete is off',
    );

    TestBed.inject(Settings).set('persona.peteConnectionId', 'local');
    await fixture.whenStable();

    expect(element().querySelector('[data-testid="pete-status"]')?.textContent).toContain(
      'Pete is learning',
    );
  });

  it('listsRecentChanges_eachWithUndo', () => {
    const rows: HTMLElement[] = [
      ...element().querySelectorAll<HTMLElement>('[data-testid="pete-recent"] li'),
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

    expect(calls).toContainEqual([PeteChannel.Undo, 'ch1']);
  });

  it('rulesOutATopic_andLetsOneBackIn', async () => {
    const component: { topicDraft: { set(value: string): void }; addTopic(): Promise<void> } =
      fixture.componentInstance as never;
    component.topicDraft.set('Politics');
    await component.addTopic();

    expect(calls).toContainEqual([PeteChannel.RuleOut, ['health', 'Politics']]);

    element().querySelector<HTMLButtonElement>('[data-testid="pete-ruled-out"] button')?.click();

    expect(calls).toContainEqual([PeteChannel.RuleOut, []]);
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
    await TestBed.inject(Pete).refresh();
    await fixture.whenStable();

    const progress: HTMLElement | null = element().querySelector('[data-testid="pete-rebuild"]');
    expect(progress?.textContent?.replace(/\s+/g, ' ')).toContain(
      'Building your persona afresh: 2 of 40 conversations read.',
    );

    progress?.querySelector('button')?.click();
    await fixture.whenStable();

    expect(calls).toContainEqual([PeteChannel.CancelRebuild, undefined]);
  });

  it('listsEarlierCopies_eachWithRestore', async () => {
    snapshots = [
      { id: '2026-11-19T12-00-00-000Z', takenAt: Date.parse('2026-11-19T12:00:00Z'), entries: 7 },
    ];
    // A fresh copy of the records, as each read over the bridge is.
    state = { ...state };
    await TestBed.inject(Pete).refresh();
    await fixture.whenStable();
    await fixture.whenStable();

    const rows: HTMLElement[] = [
      ...element().querySelectorAll<HTMLElement>('[data-testid="pete-snapshots"] li'),
    ];
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('7 entries');

    rows[0].querySelector('button')?.click();

    expect(calls).toContainEqual([PeteChannel.RestoreSnapshot, '2026-11-19T12-00-00-000Z']);
  });
});
