import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TitleStripButton } from './title-strip-button';

describe('TitleStripButton', () => {
  let component: TitleStripButton;
  let fixture: ComponentFixture<TitleStripButton>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TitleStripButton],
    }).compileComponents();

    fixture = TestBed.createComponent(TitleStripButton);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
