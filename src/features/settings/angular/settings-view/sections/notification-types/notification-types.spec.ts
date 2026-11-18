import { DebugElement } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Dropdown } from '@shared/angular/components/forms/dropdown/dropdown';
import {
  NotificationTypes,
  provideNotificationTypes,
} from '@shared/angular/services/notifications/notification-types';

import { NotificationTypesSettings } from './notification-types';

describe('NotificationTypesSettings', () => {
  let fixture: ComponentFixture<NotificationTypesSettings>;
  let types: NotificationTypes;

  /**
   * Finds the dropdown for a notification type.
   * @param id The type identifier.
   * @returns Returns the dropdown's debug element.
   */
  function dropdownFor(id: string): DebugElement {
    return fixture.debugElement.query(By.css(`[data-testid="notification-type-${id}"]`));
  }

  beforeEach(async (): Promise<void> => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [NotificationTypesSettings],
      providers: [
        provideNotificationTypes([
          {
            id: 'tests.finished',
            label: 'Test Run Finished',
            description: 'A test run finished.',
            area: 'Tests',
            default: 'history',
          },
        ]),
      ],
    }).compileComponents();
    types = TestBed.inject(NotificationTypes);
    fixture = TestBed.createComponent(NotificationTypesSettings);
    await fixture.whenStable();
  });

  afterEach((): void => {
    localStorage.clear();
  });

  it('showsOneGroupPerAreaAndOneRowPerType', (): void => {
    const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Agents');
    expect(text).toContain('Runs and Builds');
    expect(text).toContain('Tests');
    expect(text).toContain('Test Run Finished');
    expect(dropdownFor('tests.finished')).toBeTruthy();
    expect(dropdownFor('build.failed')).toBeTruthy();
  });

  it('showsEachTypesChoice_andFollowsAChangeMadeElsewhere', async (): Promise<void> => {
    expect((dropdownFor('tests.finished').componentInstance as Dropdown).value()).toBe('history');

    types.set('tests.finished', 'off');
    await fixture.whenStable();

    expect((dropdownFor('tests.finished').componentInstance as Dropdown).value()).toBe('off');
  });

  it('storesTheChoicePicked', async (): Promise<void> => {
    (dropdownFor('agent.finished').componentInstance as Dropdown).valueChange.emit('history');
    await fixture.whenStable();

    expect(types.choice('agent.finished')).toBe('history');
  });

  it('resetAll_isOfferedOnlyOnceSomethingChanged', async (): Promise<void> => {
    const reset: () => HTMLButtonElement | null = (): HTMLButtonElement | null =>
      (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
        '[data-testid="notification-types-reset"] button',
      );
    expect(reset()?.disabled).toBe(true);

    types.set('agent.failed', 'off');
    await fixture.whenStable();
    reset()?.click();
    await fixture.whenStable();

    expect(types.choice('agent.failed')).toBe('popup');
  });
});
