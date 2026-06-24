import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { RibbonStripOverflow } from './ribbon-strip-overflow';

/**
 * A host projecting three groups into the overflow component.
 */
@Component({
  imports: [RibbonStripOverflow],
  template: `
    <app-ribbon-overflow>
      <div class="group">A</div>
      <div class="group">B</div>
      <div class="group">C</div>
    </app-ribbon-overflow>
  `,
})
class HostComponent {}

/**
 * Forces a fixed scroll/visible width on an element so the layout-dependent reflow can be exercised
 * under jsdom, which does no real layout.
 * @param element The element to stub.
 * @param scrollWidth The content width to report.
 * @param clientWidth The visible width to report.
 */
function stubWidth(element: HTMLElement, scrollWidth: number, clientWidth: number): void {
  Object.defineProperty(element, 'scrollWidth', { value: scrollWidth, configurable: true });
  Object.defineProperty(element, 'clientWidth', { value: clientWidth, configurable: true });
}

/**
 * Triggers the component's private reflow pass.
 * @param component The overflow component.
 */
function reflow(component: RibbonStripOverflow): void {
  (component as unknown as { reflow: () => void }).reflow();
}

describe('RibbonStripOverflow', () => {
  let fixture: ComponentFixture<HostComponent>;
  let component: RibbonStripOverflow;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    component = fixture.debugElement.query(By.directive(RibbonStripOverflow))
      .componentInstance as RibbonStripOverflow;
    host = fixture.nativeElement as HTMLElement;
  });

  /**
   * Gets the live group count directly in the visible row (the trailing trigger and its flyout, which
   * also live in the row, are excluded by matching only direct-child groups).
   * @returns Returns the number of groups in the row.
   */
  function rowCount(): number {
    const row: HTMLElement = host.querySelector('.ribbon-overflow__row')!;
    return Array.from(row.children).filter((child: Element): boolean =>
      child.classList.contains('group'),
    ).length;
  }

  /**
   * Gets the live group count in the overflow flyout.
   * @returns Returns the number of groups in the flyout.
   */
  function flyoutCount(): number {
    return host.querySelectorAll('.ribbon-overflow__flyout > .group').length;
  }

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('reflow_whenEverythingFits_keepsAllGroupsInTheRow', () => {
    const row: HTMLElement = host.querySelector('.ribbon-overflow__row')!;
    stubWidth(row, 100, 100);
    reflow(component);
    expect(rowCount()).toBe(3);
    expect(flyoutCount()).toBe(0);
  });

  it('reflow_whenTooNarrow_movesTrailingGroupsToTheFlyout', () => {
    const row: HTMLElement = host.querySelector('.ribbon-overflow__row')!;
    stubWidth(row, 300, 100);
    reflow(component);
    expect(rowCount()).toBe(1);
    expect(flyoutCount()).toBe(2);
  });

  it('reflow_whenWidened_pullsGroupsBackFromTheFlyout', () => {
    const row: HTMLElement = host.querySelector('.ribbon-overflow__row')!;
    stubWidth(row, 300, 100);
    reflow(component);
    expect(flyoutCount()).toBe(2);

    stubWidth(row, 300, 1000);
    reflow(component);
    expect(rowCount()).toBe(3);
    expect(flyoutCount()).toBe(0);
  });

  it('more_whenGroupsOverflow_opensAndClosesTheFlyout', () => {
    const row: HTMLElement = host.querySelector('.ribbon-overflow__row')!;
    stubWidth(row, 300, 100);
    reflow(component);
    fixture.detectChanges();

    const more: HTMLButtonElement = host.querySelector('.ribbon-overflow__more')!;
    more.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    expect(host.querySelector('.ribbon-overflow__flyout--open')).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(host.querySelector('.ribbon-overflow__flyout--open')).toBeNull();
  });
});
