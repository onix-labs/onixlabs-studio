import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RibbonStrip } from './ribbon-strip';

describe('RibbonStrip', () => {
  let component: RibbonStrip;
  let fixture: ComponentFixture<RibbonStrip>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RibbonStrip],
    }).compileComponents();

    fixture = TestBed.createComponent(RibbonStrip);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
