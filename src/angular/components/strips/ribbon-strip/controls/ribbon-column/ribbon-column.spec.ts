import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RibbonColumn } from './ribbon-column';

describe('RibbonColumn', () => {
  let component: RibbonColumn;
  let fixture: ComponentFixture<RibbonColumn>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RibbonColumn],
    }).compileComponents();

    fixture = TestBed.createComponent(RibbonColumn);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
