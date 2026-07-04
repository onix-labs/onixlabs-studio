import { ComponentFixture, TestBed } from '@angular/core/testing';

import { StatusStripContainer } from './status-strip-container';

describe('StatusStripContainer', () => {
  let component: StatusStripContainer;
  let fixture: ComponentFixture<StatusStripContainer>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StatusStripContainer],
    }).compileComponents();

    fixture = TestBed.createComponent(StatusStripContainer);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_whenNoTabsOpen_showsReady', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;

    expect(element.textContent).toContain('Ready');
  });
});
