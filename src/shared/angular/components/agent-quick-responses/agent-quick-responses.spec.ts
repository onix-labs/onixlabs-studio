import { describe, expect, it, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  AgentQuickResponses as QuickResponseLibrary,
  QuickResponse,
} from '@shared/angular/services/agent-quick-responses/agent-quick-responses';
import { Settings } from '@shared/angular/services/settings/settings';
import { QuickResponseMode } from '@shared/angular/services/settings/settings-registry';
import { AgentQuickResponses, QuickResponseChoice } from './agent-quick-responses';

/**
 * The mounted menu together with what a test needs to drive it.
 */
interface Harness {
  readonly fixture: ComponentFixture<AgentQuickResponses>;
  readonly host: HTMLElement;
  readonly library: QuickResponseLibrary;
  readonly chosen: QuickResponseChoice[];
}

/**
 * Mounts the menu over the given saved replies and opens it, since everything it does is inside the
 * flyout. Nothing is saved by default — that is how a first run finds it.
 * @param saved The replies to save before mounting.
 * @param mode The Quick Responses setting, or the default when absent.
 * @param hasDraft Whether the composer holds a draft.
 * @returns Returns the harness.
 */
function open(
  saved: readonly string[] = [],
  mode?: QuickResponseMode,
  hasDraft: boolean = false,
): Harness {
  TestBed.configureTestingModule({ imports: [AgentQuickResponses] });
  const library: QuickResponseLibrary = TestBed.inject(QuickResponseLibrary);
  for (const text of saved) {
    library.add(text);
  }
  if (mode !== undefined) {
    TestBed.inject(Settings).set('ai.quickResponseMode', mode);
  }
  const fixture: ComponentFixture<AgentQuickResponses> =
    TestBed.createComponent(AgentQuickResponses);
  fixture.componentRef.setInput('hasDraft', hasDraft);
  const chosen: QuickResponseChoice[] = [];
  fixture.componentInstance.chosen.subscribe(
    (choice: QuickResponseChoice): void => void chosen.push(choice),
  );
  fixture.detectChanges();
  const host: HTMLElement = fixture.nativeElement as HTMLElement;
  host.querySelector('button')?.click();
  TestBed.tick();
  return { fixture, host, library, chosen };
}

/**
 * Reads the rows of the open flyout, which renders through the CDK overlay outside the fixture.
 * @returns Returns the row texts.
 */
function rows(): readonly string[] {
  return Array.from(document.querySelectorAll('.quick-responses__text')).map(
    (row: Element): string => row.textContent?.trim() ?? '',
  );
}

/**
 * Finds the first row's second button, the one that does the other thing (#1420).
 * @returns Returns the button, or null.
 */
function alternateButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(
    '.quick-responses__item button:not(.quick-responses__select):not([aria-label^="Delete"])',
  );
}

describe('AgentQuickResponses', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('open_whenClicked_listsTheSavedReplies', () => {
    open(['Okay', 'Merge and delete the branch']);

    expect(rows()).toContain('Okay');
    expect(rows()).toContain('Merge and delete the branch');
  });

  it('open_withNothingSaved_saysSo_ratherThanOpeningOntoABareBox', () => {
    open();

    expect(rows()).toHaveLength(0);
    expect(document.querySelector('.quick-responses__empty')?.textContent).toContain(
      'No quick responses yet',
    );
  });

  it('choose_whenARowIsClicked_reportsItsText_toSendByDefault', () => {
    const harness: Harness = open(['Okay']);

    document.querySelectorAll<HTMLButtonElement>('.quick-responses__select')[0]?.click();

    expect(harness.chosen).toEqual([{ text: 'Okay', mode: 'send' }]);
  });

  it.each([
    // A draft is never sent by a plain pick, whatever the setting.
    ['send', false, 'send'],
    ['insert', false, 'insert'],
    ['send', true, 'insert'],
    ['insert', true, 'insert'],
  ] as const)(
    'choose_withSetting %s_andDraft %s_picksTo %s',
    (setting: QuickResponseMode, hasDraft: boolean, mode: QuickResponseMode) => {
      const harness: Harness = open(['Okay'], setting, hasDraft);

      document.querySelectorAll<HTMLButtonElement>('.quick-responses__select')[0]?.click();

      expect(harness.chosen).toEqual([{ text: 'Okay', mode }]);
    },
  );

  it.each([
    // The second button does the other thing; with a draft it is the explicit Add and Send.
    ['send', false, 'Insert for Editing', 'insert'],
    ['insert', false, 'Send Now', 'send'],
    ['send', true, 'Add and Send', 'send'],
    ['insert', true, 'Add and Send', 'send'],
  ] as const)(
    'theSecondButton_withSetting %s_andDraft %s_is %s',
    (setting: QuickResponseMode, hasDraft: boolean, label: string, mode: QuickResponseMode) => {
      const harness: Harness = open(['Okay'], setting, hasDraft);

      expect(alternateButton()?.getAttribute('aria-label')).toBe(`${label}: Okay`);
      alternateButton()?.click();

      expect(harness.chosen).toEqual([{ text: 'Okay', mode }]);
    },
  );

  it('theSecondButton_closesTheMenu_asPickingARowDoes', () => {
    const harness: Harness = open(['Okay']);

    alternateButton()?.click();
    harness.fixture.detectChanges();

    expect(document.querySelector('.quick-responses__panel')).toBeNull();
  });

  it('add_whenTextIsEnteredInTheField_savesItAndClearsTheField', () => {
    const harness: Harness = open();
    const field: HTMLInputElement | null = document.querySelector<HTMLInputElement>(
      '.quick-responses__add input',
    );
    if (field === null) {
      throw new Error('The flyout has no add field.');
    }

    field.value = 'Ship it';
    field.dispatchEvent(new Event('input'));
    // Flush what was typed before committing it, as the running app does between keystrokes —
    // otherwise the binding never learns the field held anything, and clearing it is a no-op.
    harness.fixture.detectChanges();

    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    harness.fixture.detectChanges();

    expect(rows()).toContain('Ship it');
    expect(harness.library.responses().at(-1)?.text).toBe('Ship it');
    expect(field.value).toBe('');
  });

  it('open_whenRepliesAreSaved_givesEachRowAGripToSortItBy', () => {
    open(['Okay', 'Ship it']);

    const grips: NodeListOf<Element> = document.querySelectorAll('.quick-responses__grip');
    expect(grips).toHaveLength(2);
    expect(grips[0]?.getAttribute('aria-label')).toBe('Drag to reorder');
  });

  it('open_always_keepsTheAddFieldOutOfTheScrollingList', () => {
    // Structural rather than measured: the field is a sibling of the list, not a row inside it, which
    // is what keeps it at the foot of the panel once the replies start scrolling.
    open(['Okay']);

    expect(document.querySelector('.quick-responses__list .quick-responses__add')).toBeNull();
    expect(
      document.querySelector('.quick-responses__panel > .quick-responses__add'),
    ).not.toBeNull();
    expect(document.querySelector('.quick-responses__list .quick-responses__item')).not.toBeNull();
  });

  it('remove_whenTheRowDeleteIsClicked_dropsItFromTheList', () => {
    const harness: Harness = open(['Okay']);
    const deleteButton: HTMLButtonElement | null = document.querySelector<HTMLButtonElement>(
      '.quick-responses__item button[aria-label^="Delete"]',
    );

    deleteButton?.click();
    harness.fixture.detectChanges();

    expect(rows()).not.toContain('Okay');
    expect(
      harness.library.responses().map((saved: QuickResponse): string => saved.text),
    ).not.toContain('Okay');
  });
});
