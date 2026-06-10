import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ToolStrip } from './tool-strip';

describe('ToolStrip', () => {
  let component: ToolStrip;
  let fixture: ComponentFixture<ToolStrip>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ToolStrip],
    }).compileComponents();

    fixture = TestBed.createComponent(ToolStrip);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
