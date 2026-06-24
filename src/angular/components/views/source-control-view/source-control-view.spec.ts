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

  it('demoModals_whenIdle_areNotVisible', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('.modal--visible')).toBeNull();
  });

  it('openDismissable_whenClicked_showsTheModal', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const buttons: HTMLButtonElement[] = Array.from(
      element.querySelectorAll('.source-control__demo-button'),
    );

    buttons[0].click();
    fixture.detectChanges();

    // Both demo modals stay mounted; scope to the visible one. The dismissable modal shows its close
    // button.
    expect(element.querySelector('.modal--visible')).not.toBeNull();
    expect(element.querySelector('.modal--visible .modal__close')).not.toBeNull();
  });

  it('openBlocking_whenClicked_showsTheModalWithoutACloseButton', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const buttons: HTMLButtonElement[] = Array.from(
      element.querySelectorAll('.source-control__demo-button'),
    );

    buttons[1].click();
    fixture.detectChanges();

    // The visible (blocking) modal has no close button; it can only be closed by an action inside it.
    expect(element.querySelector('.modal--visible')).not.toBeNull();
    expect(element.querySelector('.modal--visible .modal__close')).toBeNull();
  });
});
