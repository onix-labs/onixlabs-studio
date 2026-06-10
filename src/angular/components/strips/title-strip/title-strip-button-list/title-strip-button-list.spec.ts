import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TitleStripButtonList } from './title-strip-button-list';

describe('TitleStripButtonList', () => {
  let component: TitleStripButtonList;
  let fixture: ComponentFixture<TitleStripButtonList>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TitleStripButtonList],
    }).compileComponents();

    fixture = TestBed.createComponent(TitleStripButtonList);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
