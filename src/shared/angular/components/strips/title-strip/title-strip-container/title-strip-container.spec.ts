import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TitleStripContainer } from './title-strip-container';

describe('TitleStripContainer', () => {
  let component: TitleStripContainer;
  let fixture: ComponentFixture<TitleStripContainer>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TitleStripContainer],
    }).compileComponents();

    fixture = TestBed.createComponent(TitleStripContainer);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
