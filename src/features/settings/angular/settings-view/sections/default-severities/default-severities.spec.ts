import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ComponentFixture } from '@angular/core/testing';
import { MultiSelect } from '@shared/angular/components/forms/multi-select/multi-select';
import { Settings } from '@shared/angular/services/settings/settings';
import { DefaultSeverities } from './default-severities';

describe('DefaultSeverities', () => {
  let fixture: ComponentFixture<DefaultSeverities>;

  /**
   * Gets the dropdown.
   * @returns Returns the multi-select.
   */
  function dropdown(): MultiSelect {
    return fixture.debugElement.query(By.directive(MultiSelect)).componentInstance as MultiSelect;
  }

  beforeEach(async () => {
    localStorage.removeItem('settings');
    await TestBed.configureTestingModule({ imports: [DefaultSeverities] }).compileComponents();
    fixture = TestBed.createComponent(DefaultSeverities);
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.removeItem('settings');
  });

  it('namesEverySeverity_inDisplayOrder', () => {
    expect(
      dropdown()
        .options()
        .map((option): string => option.label),
    ).toEqual(['Trace', 'Debug', 'Info', 'Warning', 'Error']);
  });

  it('showsTheDefaults', () => {
    expect(dropdown().value()).toEqual(['info', 'warning', 'error']);
  });

  it('writesTheSeveritiesInOrder_whateverOrderTheyWerePicked', () => {
    dropdown().value.set(['error', 'debug', 'info']);

    expect(TestBed.inject(Settings).get('systemMonitor.defaultSeverities')).toEqual([
      'debug',
      'info',
      'error',
    ]);
  });
});
