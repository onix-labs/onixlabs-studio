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
 * Opens the first row's own menu (#1420): Edit, the other of the two things picking does, and Delete.
 * @param harness The mounted menu.
 */
function openRowMenu(harness: Harness): void {
  document
    .querySelector<HTMLButtonElement>('.quick-responses__item button[aria-label^="More actions"]')
    ?.click();
  TestBed.tick();
  harness.fixture.detectChanges();
}

/**
 * Finds an item of the open row menu by its label.
 * @param label The item's label.
 * @returns Returns the item, or null.
 */
function rowMenuItem(label: string): HTMLButtonElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLButtonElement>('.app-menu-panel__item')).find(
      (item: HTMLButtonElement): boolean =>
        item.querySelector('.app-menu-panel__item-label')?.textContent?.trim() === label,
    ) ?? null
  );
}

/**
 * Reads the labels of the open row menu's items.
 * @returns Returns the labels, in order.
 */
function rowMenuLabels(): readonly string[] {
  return Array.from(document.querySelectorAll('.app-menu-panel__item-label')).map(
    (label: Element): string => label.textContent?.trim() ?? '',
  );
}

/**
 * Finds the edit field a row turns into.
 * @returns Returns its input, or null when no row is being edited.
 */
function editField(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>('.quick-responses__edit input');
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
    // The row menu's other action; with a draft it is the explicit Add and Send.
    ['send', false, 'Insert for Editing', 'insert'],
    ['insert', false, 'Send Now', 'send'],
    ['send', true, 'Add and Send', 'send'],
    ['insert', true, 'Add and Send', 'send'],
  ] as const)(
    'rowMenu_withSetting %s_andDraft %s_offers %s',
    (setting: QuickResponseMode, hasDraft: boolean, label: string, mode: QuickResponseMode) => {
      const harness: Harness = open(['Okay'], setting, hasDraft);

      openRowMenu(harness);
      expect(rowMenuLabels()).toEqual(['Edit', label, 'Delete']);
      rowMenuItem(label)?.click();
      harness.fixture.detectChanges();

      expect(harness.chosen).toEqual([{ text: 'Okay', mode }]);
      // It acts and closes everything, as picking the row does.
      expect(document.querySelector('.quick-responses__panel')).toBeNull();
    },
  );

  it('rowMenu_hasNoOtherButtonsOnTheRow', () => {
    // #1420: the row carries the pick and one More Actions button; the rest is in its menu.
    open(['Okay']);

    const buttons: readonly string[] = Array.from(
      document.querySelectorAll('.quick-responses__item button[aria-label]'),
    ).map((button: Element): string => button.getAttribute('aria-label') ?? '');
    expect(buttons).toEqual(['More actions: Okay']);
  });

  it('rowMenu_opensInTheOverlay_andInThePanelsOwnMenuStack', () => {
    // What keeps it usable from a collapsed dock panel's flyout (#1057): a press in the overlay
    // container is not a click away from the flyout, and a menu in the panel's own stack is not a
    // click away from the panel.
    const harness: Harness = open(['Okay']);

    openRowMenu(harness);

    const panel: Element | null = document.querySelector('.quick-responses__panel');
    const rowMenu: Element | null = document.querySelector('.app-menu-panel');
    expect(rowMenu?.closest('.cdk-overlay-container')).not.toBeNull();
    expect(rowMenu?.getAttribute('data-cdk-menu-stack-id')).toBe(
      panel?.getAttribute('data-cdk-menu-stack-id'),
    );
  });

  it('edit_turnsTheRowIntoAField_andKeepsThePanelOpen', () => {
    const harness: Harness = open(['Okay', 'Ship it']);

    openRowMenu(harness);
    rowMenuItem('Edit')?.click();
    harness.fixture.detectChanges();

    expect(document.querySelector('.quick-responses__panel')).not.toBeNull();
    expect(document.querySelector('.app-menu-panel')).toBeNull();
    expect(editField()?.value).toBe('Okay');
    expect(harness.chosen).toEqual([]);
  });

  it('edit_onEnter_savesInPlace', () => {
    const harness: Harness = open(['Okay', 'Ship it']);
    openRowMenu(harness);
    rowMenuItem('Edit')?.click();
    harness.fixture.detectChanges();
    const field: HTMLInputElement = editField()!;

    field.value = 'Okay, go ahead';
    field.dispatchEvent(new Event('input'));
    harness.fixture.detectChanges();
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    harness.fixture.detectChanges();

    expect(editField()).toBeNull();
    expect(rows()).toEqual(['Okay, go ahead', 'Ship it']);
    expect(document.querySelector('.quick-responses__panel')).not.toBeNull();
  });

  it('edit_onEscape_leavesTheRowAsItWas_andThePanelOpen', () => {
    const harness: Harness = open(['Okay']);
    openRowMenu(harness);
    rowMenuItem('Edit')?.click();
    harness.fixture.detectChanges();
    const field: HTMLInputElement = editField()!;

    field.value = 'Something else';
    field.dispatchEvent(new Event('input'));
    harness.fixture.detectChanges();
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    harness.fixture.detectChanges();

    expect(editField()).toBeNull();
    expect(rows()).toEqual(['Okay']);
    expect(document.querySelector('.quick-responses__panel')).not.toBeNull();
  });

  it('edit_toBlankOrADuplicate_keepsTheFieldOpen', () => {
    const harness: Harness = open(['Okay', 'Ship it']);
    openRowMenu(harness);
    rowMenuItem('Edit')?.click();
    harness.fixture.detectChanges();
    const field: HTMLInputElement = editField()!;

    field.value = 'Ship it';
    field.dispatchEvent(new Event('input'));
    harness.fixture.detectChanges();
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    harness.fixture.detectChanges();

    expect(editField()?.value).toBe('Ship it');
    expect(harness.library.responses().map((saved: QuickResponse): string => saved.text)).toEqual([
      'Okay',
      'Ship it',
    ]);
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

  it('delete_dropsTheRow_andKeepsThePanelOpen', () => {
    // Several can be cleared in a row, as the old Delete button allowed.
    const harness: Harness = open(['Okay', 'Ship it']);

    openRowMenu(harness);
    rowMenuItem('Delete')?.click();
    harness.fixture.detectChanges();

    expect(rows()).toEqual(['Ship it']);
    expect(
      harness.library.responses().map((saved: QuickResponse): string => saved.text),
    ).not.toContain('Okay');
    expect(document.querySelector('.quick-responses__panel')).not.toBeNull();
    expect(harness.chosen).toEqual([]);
  });
});
