import { beforeEach, describe, expect, it } from 'vitest';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Icon } from '@shared/angular/icons/icon';

import { TabList, TabListTab } from './tab-list';

const TABS: readonly TabListTab[] = [
  { value: 'results', label: 'Results', badge: 2 },
  { value: 'messages', label: 'Messages', badge: 1, badgeTone: 'error' },
  { value: 'plan', label: 'Plan', icon: Icon.WARNING },
];

/**
 * A host projecting content into the tab list's trailing slot.
 */
@Component({
  imports: [TabList],
  template: `
    <app-tab-list [tabs]="tabs" value="results">
      <button type="button" class="probe-trailing">Grid</button>
    </app-tab-list>
  `,
})
class ProjectingHost {
  public readonly tabs: readonly TabListTab[] = TABS;
}

describe('TabList', () => {
  let component: TabList;
  let fixture: ComponentFixture<TabList>;
  let emitted: string[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TabList],
    }).compileComponents();

    fixture = TestBed.createComponent(TabList);
    fixture.componentRef.setInput('tabs', TABS);
    fixture.componentRef.setInput('value', 'messages');
    component = fixture.componentInstance;
    emitted = [];
    component.valueChange.subscribe((value: string): void => {
      emitted.push(value);
    });
    await fixture.whenStable();
  });

  /**
   * Reads the rendered tabs.
   * @returns Returns the tab buttons, in order.
   */
  function tabs(): HTMLButtonElement[] {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    );
  }

  /**
   * Presses a key on a tab.
   * @param index The tab's index.
   * @param key The key.
   * @returns Returns the event, to read whether it was handled.
   */
  function press(index: number, key: string): KeyboardEvent {
    const event: KeyboardEvent = new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
    });
    tabs()[index].dispatchEvent(event);
    return event;
  }

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_rendersATabPerEntry_inATabList', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('[role="tablist"]')).not.toBeNull();
    expect(tabs().map((tab: HTMLButtonElement): string => tab.textContent.trim())).toEqual([
      'Results 2',
      'Messages 1',
      'Plan',
    ]);
  });

  it('render_marksOnlyTheSelectedTab_andMakesItTheOneTabStop', () => {
    expect(
      tabs().map((tab: HTMLButtonElement): string | null => tab.getAttribute('aria-selected')),
    ).toEqual(['false', 'true', 'false']);
    expect(
      tabs().map((tab: HTMLButtonElement): string | null => tab.getAttribute('tabindex')),
    ).toEqual(['-1', '0', '-1']);
    expect(tabs()[1].classList).toContain('tab-list__tab--selected');
  });

  it('ariaLabel_whenSet_namesTheTabList', async () => {
    fixture.componentRef.setInput('ariaLabel', 'Results');
    await fixture.whenStable();

    const list: Element | null = (fixture.nativeElement as HTMLElement).querySelector(
      '[role="tablist"]',
    );
    expect(list?.getAttribute('aria-label')).toBe('Results');
  });

  it('render_showsATabsIcon', () => {
    expect(tabs()[0].querySelector('app-icon')).toBeNull();
    expect(tabs()[2].querySelector('app-icon')).not.toBeNull();
  });

  it('render_showsABadge_inTheErrorToneWhenAsked', () => {
    const results: Element | null = tabs()[0].querySelector('.tab-list__badge');
    const messages: Element | null = tabs()[1].querySelector('.tab-list__badge');

    expect(results?.textContent.trim()).toBe('2');
    expect(results?.classList).not.toContain('tab-list__badge--error');
    expect(messages?.textContent.trim()).toBe('1');
    expect(messages?.classList).toContain('tab-list__badge--error');
    expect(tabs()[2].querySelector('.tab-list__badge')).toBeNull();
  });

  it('click_onAnotherTab_emitsItsValue', () => {
    tabs()[2].click();

    expect(emitted).toEqual(['plan']);
  });

  it('click_onTheSelectedTab_emitsNothing', () => {
    tabs()[1].click();

    expect(emitted).toEqual([]);
  });

  it('arrowRight_selectsAndFocusesTheNextTab', () => {
    const event: KeyboardEvent = press(1, 'ArrowRight');

    expect(emitted).toEqual(['plan']);
    expect(document.activeElement).toBe(tabs()[2]);
    expect(event.defaultPrevented).toBe(true);
  });

  it('arrowLeft_selectsAndFocusesThePreviousTab', () => {
    press(1, 'ArrowLeft');

    expect(emitted).toEqual(['results']);
    expect(document.activeElement).toBe(tabs()[0]);
  });

  it('arrowRight_onTheLastTab_wrapsToTheFirst', async () => {
    fixture.componentRef.setInput('value', 'plan');
    await fixture.whenStable();

    press(2, 'ArrowRight');

    expect(emitted).toEqual(['results']);
    expect(document.activeElement).toBe(tabs()[0]);
  });

  it('arrowLeft_onTheFirstTab_wrapsToTheLast', async () => {
    fixture.componentRef.setInput('value', 'results');
    await fixture.whenStable();

    press(0, 'ArrowLeft');

    expect(emitted).toEqual(['plan']);
    expect(document.activeElement).toBe(tabs()[2]);
  });

  it('homeAndEnd_selectAndFocusTheFirstAndLastTabs', () => {
    press(1, 'End');
    expect(emitted).toEqual(['plan']);
    expect(document.activeElement).toBe(tabs()[2]);

    press(1, 'Home');
    expect(emitted).toEqual(['plan', 'results']);
    expect(document.activeElement).toBe(tabs()[0]);
  });

  it('anotherKey_isLeftAlone', () => {
    const event: KeyboardEvent = press(1, 'Enter');

    expect(emitted).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it('aMoveToTheSelectedTab_focusesItWithoutEmitting', async () => {
    fixture.componentRef.setInput('value', 'results');
    await fixture.whenStable();

    press(2, 'Home');

    expect(emitted).toEqual([]);
    expect(document.activeElement).toBe(tabs()[0]);
  });
});

describe('TabList projected content', () => {
  it('render_showsProjectedContentInTheTrailingSlot', async () => {
    await TestBed.configureTestingModule({ imports: [ProjectingHost] }).compileComponents();
    const fixture: ComponentFixture<ProjectingHost> = TestBed.createComponent(ProjectingHost);
    await fixture.whenStable();

    const trailing: Element | null = (fixture.nativeElement as HTMLElement).querySelector(
      '.tab-list__trailing',
    );
    expect(trailing?.querySelector('.probe-trailing')?.textContent).toBe('Grid');
    expect(trailing?.closest('[role="tablist"]')).not.toBeNull();
  });
});
