import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { SummaryItem, ViewSummary } from './view-summary';

/**
 * Renders a summary of the given figures.
 * @param items The figures.
 * @returns Returns the rendered element.
 */
function render(items: readonly SummaryItem[]): HTMLElement {
  const fixture: ComponentFixture<ViewSummary> = TestBed.createComponent(ViewSummary);
  fixture.componentRef.setInput('items', items);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('ViewSummary', () => {
  it('putsEachLabelOverItsValue', () => {
    const host: HTMLElement = render([
      { label: 'Total', value: '187' },
      { label: 'Error', value: '2', tone: 'danger' },
    ]);
    const items: HTMLElement[] = Array.from(host.querySelectorAll('li'));

    expect(
      items.map(
        (item: HTMLElement): string =>
          `${item.querySelector('.view-summary__label')?.textContent?.trim()}/${item.querySelector('.view-summary__value')?.textContent?.trim()}`,
      ),
    ).toEqual(['Total/187', 'Error/2']);
    expect(items[1].classList).toContain('view-summary__item--danger');
    expect(items[0].className).not.toContain('--');
  });

  it('drawsNothing_withNoFigures', () => {
    expect(render([]).querySelector('ul')).toBeNull();
  });
});
