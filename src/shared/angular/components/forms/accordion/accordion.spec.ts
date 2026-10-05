import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Icon } from '@shared/angular/icons/icon';
import { Accordion } from './accordion';

/**
 * Hosts an accordion with a header action, counting the action's clicks.
 */
@Component({
  imports: [Accordion],
  template: `
    <app-accordion heading="Claude">
      <button accordionActions class="action" (click)="clicks = clicks + 1">Delete</button>
      <p class="content">Body</p>
    </app-accordion>
  `,
})
class AccordionWithAction {
  /**
   * Gets how many times the header action was clicked.
   */
  public clicks: number = 0;
}

describe('Accordion with a header action', () => {
  it('render_placesTheActionInTheHeader_outsideTheToggle', async () => {
    const fixture: ComponentFixture<AccordionWithAction> =
      TestBed.createComponent(AccordionWithAction);
    await fixture.whenStable();
    const element: HTMLElement = fixture.nativeElement as HTMLElement;

    const action: HTMLElement | null = element.querySelector('.action');
    expect(action?.closest('.accordion__actions')).not.toBeNull();
    // A button may not hold another, and the action must not also toggle the panel.
    expect(action?.closest('.accordion__header')).toBeNull();
    // And it sits to the left of the caret.
    expect(
      element
        .querySelector('.accordion__actions')
        ?.nextElementSibling?.classList.contains('accordion__caret'),
    ).toBe(true);
  });

  it('action_whenClicked_runsWithoutTogglingThePanel', async () => {
    const fixture: ComponentFixture<AccordionWithAction> =
      TestBed.createComponent(AccordionWithAction);
    await fixture.whenStable();
    const element: HTMLElement = fixture.nativeElement as HTMLElement;

    element.querySelector<HTMLButtonElement>('.action')?.click();
    await fixture.whenStable();

    expect(fixture.componentInstance.clicks).toBe(1);
    expect(element.querySelector('.content')).toBeNull();
  });
});

describe('Accordion', () => {
  let component: Accordion;
  let fixture: ComponentFixture<Accordion>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Accordion],
    }).compileComponents();

    fixture = TestBed.createComponent(Accordion);
    fixture.componentRef.setInput('heading', 'TypeScript');
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('expanded_whenHeaderClicked_togglesOpen', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLButtonElement>('.accordion__header')?.click();

    expect(component.expanded()).toBe(true);
  });

  it('render_whenCollapsed_hidesTheBody', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.accordion__body')).toBeNull();
  });

  it('render_whenNoIcon_omitsTheLeadingIcon', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.accordion__icon')).toBeNull();
    expect(element.querySelector('.accordion__caret')).not.toBeNull();
  });

  it('render_whenIconGiven_showsItAheadOfTheHeading', async () => {
    fixture.componentRef.setInput('icon', Icon.SUCCESS_FILL);
    await fixture.whenStable();

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const header: HTMLElement | null = element.querySelector('.accordion__header');
    expect(header?.firstElementChild?.classList.contains('accordion__icon')).toBe(true);
    // The caret closes the header row, after any actions.
    const bar: HTMLElement | null = element.querySelector('.accordion__bar');
    expect(bar?.lastElementChild?.classList.contains('accordion__caret')).toBe(true);
  });

  it('caret_whenClicked_togglesOpen', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLElement>('.accordion__caret')?.click();

    expect(component.expanded()).toBe(true);
  });
});
