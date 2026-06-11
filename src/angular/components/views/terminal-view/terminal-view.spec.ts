import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TerminalView } from './terminal-view';

describe('TerminalView', () => {
  let component: TerminalView;
  let fixture: ComponentFixture<TerminalView>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TerminalView],
    }).compileComponents();

    fixture = TestBed.createComponent(TerminalView);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
