import { Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ModalBackdrop } from '@shared/angular/services/modal-backdrop/modal-backdrop';
import { ModalWindowRequest, ModalWindows } from '@shared/angular/services/modal-windows/modal-windows';
import { FakeModalWindows } from '@shared/angular/services/modal-windows/modal-windows.fake';

import { Modal } from './modal';
import { ModalContent } from './modal-content';

/**
 * A host whose content is marked for window presentation.
 */
@Component({
  imports: [Modal, ModalContent],
  template: `
    <app-modal
      [open]="open()"
      [dismissable]="dismissable()"
      [expandable]="expandable()"
      [width]="width()"
      [minWidth]="minWidth()"
      [maxWidth]="maxWidth()"
      [minHeight]="minHeight()"
      [maxHeight]="maxHeight()"
      ariaLabel="Windowed modal"
      (dismiss)="onDismiss()"
    >
      <ng-template appModalContent>
        <p class="modal-content">Body</p>
      </ng-template>
    </app-modal>
  `,
})
class WindowedHost {
  public readonly open: WritableSignal<boolean> = signal<boolean>(false);
  public readonly dismissable: WritableSignal<boolean> = signal<boolean>(true);
  public readonly expandable: WritableSignal<boolean> = signal<boolean>(false);
  public readonly width: WritableSignal<number | undefined> = signal<number | undefined>(26);
  public readonly minWidth: WritableSignal<number | undefined> = signal<number | undefined>(
    undefined,
  );
  public readonly maxWidth: WritableSignal<number | undefined> = signal<number | undefined>(
    undefined,
  );
  public readonly minHeight: WritableSignal<number | undefined> = signal<number | undefined>(
    undefined,
  );
  public readonly maxHeight: WritableSignal<number | undefined> = signal<number | undefined>(
    undefined,
  );
  public dismissed: number = 0;

  public onDismiss(): void {
    this.dismissed += 1;
  }
}

describe('Modal', () => {
  let fixture: ComponentFixture<WindowedHost>;
  let component: WindowedHost;
  let host: HTMLElement;
  let windows: FakeModalWindows;
  let backdrop: ModalBackdrop;

  beforeEach(async () => {
    windows = new FakeModalWindows();
    await TestBed.configureTestingModule({
      imports: [WindowedHost],
      providers: [{ provide: ModalWindows, useValue: windows }],
    }).compileComponents();

    fixture = TestBed.createComponent(WindowedHost);
    component = fixture.componentInstance;
    host = fixture.nativeElement as HTMLElement;
    backdrop = TestBed.inject(ModalBackdrop);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('open_whenTemplated_opensAWindowAndRendersContentThere', () => {
    component.open.set(true);
    fixture.detectChanges();

    expect(windows.requests.length).toBe(1);
    // The modal renders nothing where it is declared; its content lives in the window.
    expect(host.querySelector('.modal-content')).toBeNull();
    expect(windows.contentHost?.querySelector('.modal-content')?.textContent).toContain('Body');
  });

  it('open_whenTemplated_raisesTheBackdropOverTheRaisingWindow', () => {
    component.open.set(true);
    fixture.detectChanges();

    expect(backdrop.raised()).toBe(true);
  });

  it('open_whenNoWindowOpens_emitsDismissRatherThanStranding', () => {
    windows.refuseOpen = true;
    component.open.set(true);
    fixture.detectChanges();

    // The open was attempted, refused, and reported back as a dismissal so the caller unsticks.
    expect(windows.requests.length).toBe(1);
    expect(windows.openWindows).toBe(0);
    expect(component.dismissed).toBe(1);
    expect(backdrop.raised()).toBe(false);
  });

  it('request_carriesTheModalsTitleWidthAndChrome', () => {
    component.open.set(true);
    fixture.detectChanges();

    const request: ModalWindowRequest = windows.requests[0];
    expect(request.title).toBe('Windowed modal');
    expect(request.width).toBeGreaterThan(0);
    expect(request.resizable).toBe(false);
    expect(request.closable).toBe(true);
    expect(request.parented).toBe(true);
  });

  it('request_whenBoundsAreStated_carriesThemAsTheWindowsResizeLimits', () => {
    component.minWidth.set(60);
    component.minHeight.set(37.5);
    component.maxWidth.set(64);
    component.maxHeight.set(45);
    component.open.set(true);
    fixture.detectChanges();

    const request: ModalWindowRequest = windows.requests[0];
    expect(request.minimum).toEqual({ width: 960, height: 600 });
    expect(request.maximum).toEqual({ width: 1024, height: 720 });
  });

  it('request_whenNoBoundsAreStated_leavesThemToTheWindowDefaults', () => {
    component.open.set(true);
    fixture.detectChanges();

    expect(windows.requests[0].minimum).toBeNull();
    expect(windows.requests[0].maximum).toBeNull();
  });

  it('request_whenAMaximumIsStated_holdsTheOpeningWidthWithinIt', () => {
    // Far wider than the maximum allows, and wider than the space available — the ceiling wins.
    component.width.set(200);
    component.maxWidth.set(40);
    component.open.set(true);
    fixture.detectChanges();

    expect(windows.requests[0].width).toBe(640);
  });

  it('request_whenAMinimumExceedsTheSpaceAvailable_theMinimumStillWins', () => {
    // A modal that cannot fit is better oversized than unusable.
    component.width.set(10);
    component.minWidth.set(120);
    component.minHeight.set(37.5);
    component.open.set(true);
    fixture.detectChanges();

    expect(windows.requests[0].width).toBe(1920);
  });

  it('request_carriesTheColourTheModalsPanelWillLandOn', () => {
    // The window paints this until its content arrives, so it opens on its own colour.
    host
      .querySelector<HTMLElement>('app-modal')!
      .style.setProperty('--modal-panel-background-color', '#1e2124');
    component.open.set(true);
    fixture.detectChanges();

    expect(windows.requests[0].background).toBe('#1e2124');
  });

  it('request_whenTheColourIsStatedInFractionalChannels_carriesItAsATriplet', () => {
    // What the engine hands back for a colour it worked out itself: the dark theme's panel surface
    // is a color-mix, and it resolves to this rather than to an rgb().
    host
      .querySelector<HTMLElement>('app-modal')!
      .style.setProperty(
        '--modal-panel-background-color',
        'color(srgb 0.166667 0.186275 0.205882)',
      );
    component.open.set(true);
    fixture.detectChanges();

    expect(windows.requests[0].background).toBe('#2b3034');
  });

  it('request_whenThePanelColourCannotBeResolved_fallsBackToTheBodyRatherThanNothing', () => {
    // The dark theme states the panel surface as a color-mix, which only a real engine works out;
    // whatever the panel colour turns out to be, a modal must still open on SOME colour.
    const element: HTMLElement = host.querySelector<HTMLElement>('app-modal')!;
    element.style.setProperty('--modal-panel-background-color', 'linear-gradient(red, blue)');
    element.style.setProperty('--body-background-color', '#212529');
    component.open.set(true);
    fixture.detectChanges();

    expect(windows.requests[0].background).toBe('#212529');
  });

  it('request_whenExpandable_asksForAResizableWindow', () => {
    component.expandable.set(true);
    component.open.set(true);
    fixture.detectChanges();

    expect(windows.requests[0].resizable).toBe(true);
  });

  it('request_whenNotDismissable_asksForAWindowThatCannotBeClosed', () => {
    component.dismissable.set(false);
    component.open.set(true);
    fixture.detectChanges();

    expect(windows.requests[0].closable).toBe(false);
  });

  it('backdropClick_whileOpen_dismissesTheModal', () => {
    component.open.set(true);
    fixture.detectChanges();

    backdrop.requestDismiss();
    fixture.detectChanges();

    expect(component.dismissed).toBe(1);
  });

  it('backdropClick_whenNotDismissable_leavesTheModalOpen', () => {
    component.dismissable.set(false);
    component.open.set(true);
    fixture.detectChanges();

    backdrop.requestDismiss();
    fixture.detectChanges();

    expect(component.dismissed).toBe(0);
    expect(windows.closed).toBe(0);
  });

  it('open_whenClosedByTheCaller_closesTheWindowAndLowersTheBackdrop', () => {
    component.open.set(true);
    fixture.detectChanges();

    component.open.set(false);
    fixture.detectChanges();

    expect(windows.closed).toBe(1);
    expect(backdrop.raised()).toBe(false);
  });

  it('windowClosed_whileStillOpen_emitsDismiss', () => {
    component.open.set(true);
    fixture.detectChanges();

    windows.notifyClosed();
    fixture.detectChanges();

    expect(component.dismissed).toBe(1);
  });

  it('windowClosed_afterTheCallerClosedIt_doesNotEmitDismissAgain', () => {
    component.open.set(true);
    fixture.detectChanges();

    component.open.set(false);
    fixture.detectChanges();

    expect(component.dismissed).toBe(0);
  });
});
