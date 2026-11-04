import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ComponentFixture } from '@angular/core/testing';
import { Checkbox } from '@shared/angular/components/forms/checkbox/checkbox';
import { Settings } from '@shared/angular/services/settings/settings';
import { DefaultSeverities } from './default-severities';

describe('DefaultSeverities', () => {
  let fixture: ComponentFixture<DefaultSeverities>;

  beforeEach(async () => {
    localStorage.removeItem('settings');
    await TestBed.configureTestingModule({ imports: [DefaultSeverities] }).compileComponents();
    fixture = TestBed.createComponent(DefaultSeverities);
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.removeItem('settings');
  });

  it('ticksTheDefaults', () => {
    const ticks: boolean[] = fixture.debugElement
      .queryAll(By.directive(Checkbox))
      .map((each): boolean => (each.componentInstance as Checkbox).checked());
    expect(ticks).toEqual([false, false, true, true, true]);
  });

  it('writesTheSeveritiesInOrder_whenOneIsTicked', () => {
    const debug: Checkbox = fixture.debugElement.queryAll(By.directive(Checkbox))[1]
      .componentInstance as Checkbox;

    debug.checked.set(true);

    expect(TestBed.inject(Settings).get('systemMonitor.defaultSeverities')).toEqual([
      'debug',
      'info',
      'warning',
      'error',
    ]);
  });
});
