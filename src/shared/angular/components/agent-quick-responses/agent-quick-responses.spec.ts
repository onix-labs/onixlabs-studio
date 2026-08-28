import { describe, expect, it, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  AgentQuickResponses as QuickResponseLibrary,
  QuickResponse,
} from '@shared/angular/services/agent-quick-responses/agent-quick-responses';
import { AgentQuickResponses } from './agent-quick-responses';

/**
 * The mounted menu together with what a test needs to drive it.
 */
interface Harness {
  readonly fixture: ComponentFixture<AgentQuickResponses>;
  readonly host: HTMLElement;
  readonly library: QuickResponseLibrary;
  readonly chosen: string[];
}

/**
 * Mounts the menu over the given saved replies and opens it, since everything it does is inside the
 * flyout. Nothing is saved by default — that is how a first run finds it.
 * @param saved The replies to save before mounting.
 * @returns Returns the harness.
 */
function open(saved: readonly string[] = []): Harness {
  TestBed.configureTestingModule({ imports: [AgentQuickResponses] });
  const library: QuickResponseLibrary = TestBed.inject(QuickResponseLibrary);
  for (const text of saved) {
    library.add(text);
  }
  const fixture: ComponentFixture<AgentQuickResponses> =
    TestBed.createComponent(AgentQuickResponses);
  const chosen: string[] = [];
  fixture.componentInstance.chosen.subscribe((text: string): void => void chosen.push(text));
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

  it('choose_whenARowIsClicked_reportsItsText', () => {
    const harness: Harness = open(['Okay']);

    document.querySelectorAll<HTMLButtonElement>('.quick-responses__select')[0]?.click();

    expect(harness.chosen).toEqual(['Okay']);
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

  it('remove_whenTheRowDeleteIsClicked_dropsItFromTheList', () => {
    const harness: Harness = open(['Okay']);
    const deleteButton: HTMLButtonElement | null = document.querySelector<HTMLButtonElement>(
      '.quick-responses__item app-button button',
    );

    deleteButton?.click();
    harness.fixture.detectChanges();

    expect(rows()).not.toContain('Okay');
    expect(
      harness.library.responses().map((saved: QuickResponse): string => saved.text),
    ).not.toContain('Okay');
  });
});
