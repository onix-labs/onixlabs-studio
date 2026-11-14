import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { DashboardBadge } from './dashboard-badge';

describe('DashboardBadge', () => {
  let fixture: ComponentFixture<DashboardBadge>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [DashboardBadge] }).compileComponents();
    fixture = TestBed.createComponent(DashboardBadge);
    host = fixture.nativeElement as HTMLElement;
  });

  it('showsItsReading_captionedWhenGivenACaption', async () => {
    fixture.componentRef.setInput('value', '467.7 KB/s');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(host.textContent?.trim()).toBe('467.7 KB/s');

    fixture.componentRef.setInput('caption', 'Read');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(host.textContent).toContain('Read');
  });
});
