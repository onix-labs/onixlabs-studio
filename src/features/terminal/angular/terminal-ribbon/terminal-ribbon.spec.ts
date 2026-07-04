import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TerminalRibbon } from './terminal-ribbon';

describe('TerminalRibbon', () => {
  let component: TerminalRibbon;
  let fixture: ComponentFixture<TerminalRibbon>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TerminalRibbon],
    }).compileComponents();

    fixture = TestBed.createComponent(TerminalRibbon);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
