import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { Icon } from '@shared/angular/icons/icon';
import { DashboardCard } from './dashboard-card';

describe('DashboardCard', () => {
  let fixture: ComponentFixture<DashboardCard>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [DashboardCard] }).compileComponents();
    fixture = TestBed.createComponent(DashboardCard);
    host = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('icon', Icon.MONITOR_CPU);
    fixture.componentRef.setInput('heading', 'CPU');
    fixture.componentRef.setInput('subtitle', 'Processor utilisation');
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('showsItsHeadingAndWhatItCovers', () => {
    expect(host.querySelector('article')?.getAttribute('aria-label')).toBe('CPU');
    expect(host.textContent).toContain('Processor utilisation');
  });

  it('asksForItsFullView_fromItsLink', () => {
    let asked: number = 0;
    fixture.componentInstance.details.subscribe((): void => {
      asked += 1;
    });

    host.querySelector<HTMLButtonElement>('footer button')?.click();

    expect(asked).toBe(1);
  });
});
