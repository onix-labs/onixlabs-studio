import { ApplicationRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { Bridge } from '@shared/api/bridge';
import type { PersonaEntry } from '@shared/api/persona-channels';
import { PeteChannel, type PersonaChange, type PeteState } from '@shared/api/pete-protocol';
import { ModalWindows } from '@shared/angular/services/modal-windows/modal-windows';
import { FakeModalWindows } from '@shared/angular/services/modal-windows/modal-windows.fake';
import { Pete } from '@shared/angular/services/persona/pete';
import { PersonaReview } from './persona-review';

/**
 * Builds an entry.
 * @param id The id.
 * @param text The text.
 * @returns Returns the entry.
 */
function entry(id: string, text: string): PersonaEntry {
  return {
    id,
    name: `Entry ${id}`,
    text,
    why: '',
    tags: ['travel'],
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

describe('PersonaReview (#1517)', () => {
  let fixture: ComponentFixture<PersonaReview>;
  let reviews: unknown[];
  let state: PeteState;
  let windows: FakeModalWindows;

  beforeEach(async () => {
    reviews = [];
    const pending: readonly PersonaChange[] = [
      {
        id: 'a',
        at: 0,
        kind: 'add',
        entryId: 'one',
        before: null,
        after: entry('one', 'Takes trains.'),
        reason: 'Said so twice.',
      },
      {
        id: 'b',
        at: 0,
        kind: 'change',
        entryId: 'two',
        before: entry('two', 'Old text.'),
        after: entry('two', 'New text.'),
        reason: '',
      },
      {
        id: 'c',
        at: 0,
        kind: 'remove',
        entryId: 'three',
        before: entry('three', 'Vague.'),
        after: null,
        reason: '',
      },
    ];
    state = { recent: [], pending, ruledOut: [], questions: [], lastRun: 0 };
    const bridge: Partial<Bridge> = {
      invoke: <T>(channel: string, arg?: unknown): Promise<T> => {
        if (channel === (PeteChannel.Review as string)) {
          reviews.push(arg);
          const decided: { accept: readonly string[]; reject: readonly string[] } = arg as never;
          state = {
            ...state,
            pending: state.pending.filter(
              (change: PersonaChange): boolean =>
                !decided.accept.includes(change.id) && !decided.reject.includes(change.id),
            ),
          };
          return Promise.resolve(decided.accept.length as T);
        }
        return Promise.resolve(
          (channel === (PeteChannel.State as string) ? state : undefined) as T,
        );
      },
      on: (): (() => void) => (): void => undefined,
    };
    (window as unknown as { bridge?: Partial<Bridge> }).bridge = bridge;
    windows = new FakeModalWindows();
    TestBed.configureTestingModule({ providers: [{ provide: ModalWindows, useValue: windows }] });
    fixture = TestBed.createComponent(PersonaReview);
    await TestBed.inject(Pete).refresh();
    TestBed.inject(Pete).openReview();
    await settle();
  });

  afterEach(() => {
    fixture.destroy();
    delete (window as unknown as { bridge?: Bridge }).bridge;
  });

  /**
   * Lets the review render into its window.
   * @returns Resolves once rendered.
   */
  async function settle(): Promise<void> {
    await fixture.whenStable();
    TestBed.inject(ApplicationRef).tick();
    TestBed.inject(ApplicationRef).tick();
  }

  /**
   * Gets the review's window.
   * @returns Returns its content.
   */
  function host(): HTMLElement {
    return windows.contentHost ?? document.createElement('div');
  }

  /**
   * Gets the review's cards.
   * @returns Returns them.
   */
  function cards(): HTMLElement[] {
    return [...host().querySelectorAll<HTMLElement>('[data-testid="persona-review-list"] li')];
  }

  /**
   * Finds a button by its text inside an element.
   * @param root The element.
   * @param label The text.
   * @returns Returns the button.
   */
  function button(root: ParentNode, label: string): HTMLButtonElement | undefined {
    return [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      (candidate: HTMLButtonElement): boolean => candidate.textContent?.trim() === label,
    );
  }

  it('showsEachChangeAsAddedChangedOrRemoved_withBeforeAndAfter', () => {
    expect(
      cards().map(
        (card: HTMLElement): string => card.querySelector('app-chip')?.textContent?.trim() ?? '',
      ),
    ).toEqual(['Added', 'Changed', 'Removed']);
    expect(cards()[0].textContent).toContain('Said so twice.');
    expect(cards()[1].querySelector('.review__text--before')?.textContent).toContain('Old text.');
    expect(cards()[1].textContent).toContain('New text.');
    expect(cards()[2].querySelector('.review__text--before')?.textContent).toContain('Vague.');
  });

  it('acceptsOrRejectsOne_andLeavesTheRestWaiting', async () => {
    button(cards()[0], 'Accept')?.click();
    await settle();
    button(cards()[0], 'Reject')?.click();
    await settle();

    expect(reviews).toEqual([
      { accept: ['a'], reject: [] },
      { accept: [], reject: ['b'] },
    ]);
    expect(TestBed.inject(Pete).reviewOpen()).toBe(true);
  });

  it('acceptAll_acceptsEverything_andCloses', async () => {
    button(host(), 'Accept All')?.click();
    await settle();

    expect(reviews).toEqual([{ accept: ['a', 'b', 'c'], reject: [] }]);
    expect(TestBed.inject(Pete).reviewOpen()).toBe(false);
  });
});
