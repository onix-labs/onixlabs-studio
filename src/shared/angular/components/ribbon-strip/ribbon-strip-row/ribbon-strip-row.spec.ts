import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RibbonStripRow } from './ribbon-strip-row';

@Component({
  imports: [RibbonStripRow],
  template: `
    <app-ribbon-strip-row>
      <button type="button" class="probe-first">First</button>
      <button type="button" class="probe-second">Second</button>
    </app-ribbon-strip-row>
  `,
})
class TestHost {}

describe('RibbonStripRow', () => {
  let fixture: ComponentFixture<TestHost>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHost],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHost);
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(host.querySelector('app-ribbon-strip-row')).not.toBeNull();
  });

  it('render_projectsItsControlsIntoTheRowInOrder', () => {
    const row: HTMLElement = host.querySelector<HTMLElement>('app-ribbon-strip-row')!;
    const buttons: HTMLButtonElement[] = Array.from(
      row.querySelectorAll<HTMLButtonElement>('button'),
    );

    expect(buttons.length).toBe(2);
    expect(buttons[0].classList).toContain('probe-first');
    expect(buttons[1].classList).toContain('probe-second');
  });
});
