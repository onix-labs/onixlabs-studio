import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RibbonStripContainer } from './ribbon-strip-container';

describe('RibbonStripContainer', () => {
  let component: RibbonStripContainer;
  let fixture: ComponentFixture<RibbonStripContainer>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RibbonStripContainer],
    }).compileComponents();

    fixture = TestBed.createComponent(RibbonStripContainer);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
