import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RibbonStripColumn } from './ribbon-strip-column';

describe('RibbonStripColumn', () => {
  let component: RibbonStripColumn;
  let fixture: ComponentFixture<RibbonStripColumn>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RibbonStripColumn],
    }).compileComponents();

    fixture = TestBed.createComponent(RibbonStripColumn);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
