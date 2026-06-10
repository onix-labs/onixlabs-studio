import { ComponentFixture, TestBed } from '@angular/core/testing';

import { StatusStrip } from './status-strip';

describe('StatusStrip', () => {
  let component: StatusStrip;
  let fixture: ComponentFixture<StatusStrip>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StatusStrip],
    }).compileComponents();

    fixture = TestBed.createComponent(StatusStrip);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
