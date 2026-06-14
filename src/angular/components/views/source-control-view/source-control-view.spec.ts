import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SourceControlView } from './source-control-view';

describe('SourceControlView', () => {
  let component: SourceControlView;
  let fixture: ComponentFixture<SourceControlView>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SourceControlView],
    }).compileComponents();

    fixture = TestBed.createComponent(SourceControlView);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_whenShown_showsThePlaceholderIdentity', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('.source-control__title')?.textContent).toContain('Source Control');
  });
});
