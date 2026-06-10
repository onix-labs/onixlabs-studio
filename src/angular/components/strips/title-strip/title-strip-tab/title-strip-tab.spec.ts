import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TitleStripTab } from './title-strip-tab';

describe('TitleStripTab', () => {
  let component: TitleStripTab;
  let fixture: ComponentFixture<TitleStripTab>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TitleStripTab],
    }).compileComponents();

    fixture = TestBed.createComponent(TitleStripTab);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
