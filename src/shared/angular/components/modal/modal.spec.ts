import { Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ModalBackdrop } from '@shared/angular/services/modal-backdrop/modal-backdrop';
import {
  ModalWindow,
  ModalWindowRequest,
  ModalWindows,
} from '@shared/angular/services/modal-windows/modal-windows';

import { Modal } from './modal';
import { ModalContent } from './modal-content';

@Component({
  imports: [Modal],
  template: `
    <app-modal
      [open]="open()"
      [dismissable]="dismissable()"
      [width]="width()"
      ariaLabel="Test modal"
      (dismiss)="onDismiss()"
    >
      <p class="modal-content">Body</p>
    </app-modal>
  `,
})
class TestHost {
  public readonly open: WritableSignal<boolean> = signal<boolean>(true);
  public readonly dismissable: WritableSignal<boolean> = signal<boolean>(true);
  public readonly width: WritableSignal<number | undefined> = signal<number | undefined>(undefined);
  public dismissed: number = 0;

  public onDismiss(): void {
    this.dismissed += 1;
  }
}

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

/**
 * A stand-in for the modal window opener, recording what was asked for and letting the test drive
 * the window's own events. Its content host is a detached element in the test document, which is
 * where the modal's content renders.
 */
class FakeModalWindows {
  public readonly requests: ModalWindowRequest[] = [];
  public readonly fitted: { width: number; height: number }[] = [];
  public contentHost: HTMLElement | null = null;
  public closed: number = 0;
  private closedListeners: (() => void)[] = [];

  public open(request: ModalWindowRequest): ModalWindow | null {
    this.requests.push(request);
    const contentHost: HTMLElement = document.createElement('div');
    this.contentHost = contentHost;
    return {
      contentHost,
      document,
      view: window,
      fit: (width: number, height: number): void => {
        this.fitted.push({ width, height });
      },
      focus: (): void => undefined,
      close: (): void => this.notifyClosed(),
      onClosed: (listener: () => void): void => {
        this.closedListeners.push(listener);
      },
    };
  }

  public notifyClosed(): void {
    this.closed += 1;
    const listeners: (() => void)[] = this.closedListeners;
    this.closedListeners = [];
    for (const listener of listeners) {
      listener();
    }
  }
}

describe('Modal', () => {
  let fixture: ComponentFixture<TestHost>;
  let component: TestHost;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHost],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHost);
    component = fixture.componentInstance;
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('open_whenTrue_isVisibleAndProjectsContent', () => {
    expect(host.querySelector('.modal--visible')).not.toBeNull();
    expect(host.querySelector('.modal-content')?.textContent).toContain('Body');
  });

  it('width_whenSet_sizesThePanel', () => {
    component.width.set(30);
    fixture.detectChanges();

    const panel: HTMLElement = host.querySelector<HTMLElement>('.modal__panel')!;
    expect(panel.style.getPropertyValue('--modal-panel-inline-size')).toBe('min(30rem, 100%)');
  });

  it('width_whenUnset_defersToTheThemedDefault', () => {
    const panel: HTMLElement = host.querySelector<HTMLElement>('.modal__panel')!;
    expect(panel.style.getPropertyValue('--modal-panel-inline-size')).toBe('');
  });

  it('open_whenFalse_isNotVisible', () => {
    component.open.set(false);
    fixture.detectChanges();

    expect(host.querySelector('.modal--visible')).toBeNull();
  });

  it('backdropClick_whenDismissable_emitsDismiss', () => {
    const backdrop: HTMLElement = host.querySelector<HTMLElement>('.modal')!;
    backdrop.click();

    expect(component.dismissed).toBe(1);
  });

  it('panelClick_whenDismissable_doesNotEmitDismiss', () => {
    const panel: HTMLElement = host.querySelector<HTMLElement>('.modal__panel')!;
    panel.click();

    expect(component.dismissed).toBe(0);
  });

  it('escapeKey_whenDismissable_emitsDismiss', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();

    expect(component.dismissed).toBe(1);
  });

  it('closeButton_whenDismissable_isShownAndEmitsDismiss', () => {
    const close: HTMLButtonElement | null =
      host.querySelector<HTMLButtonElement>('.modal__control');
    expect(close).not.toBeNull();

    close!.click();

    expect(component.dismissed).toBe(1);
  });

  it('backdropClick_whenNotDismissable_doesNotEmitDismiss', () => {
    component.dismissable.set(false);
    fixture.detectChanges();

    const backdrop: HTMLElement = host.querySelector<HTMLElement>('.modal')!;
    backdrop.click();

    expect(component.dismissed).toBe(0);
  });

  it('escapeKey_whenNotDismissable_doesNotEmitDismiss', () => {
    component.dismissable.set(false);
    fixture.detectChanges();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();

    expect(component.dismissed).toBe(0);
  });

  it('closeButton_whenNotDismissable_isNotShown', () => {
    component.dismissable.set(false);
    fixture.detectChanges();

    expect(host.querySelector('.modal__control')).toBeNull();
  });
});

describe('Modal (window presentation)', () => {
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

  it('open_whenTemplated_opensAWindowInsteadOfTheInlineOverlay', () => {
    component.open.set(true);
    fixture.detectChanges();

    expect(windows.requests.length).toBe(1);
    expect(host.querySelector('.modal--visible')).toBeNull();
    expect(windows.contentHost?.querySelector('.modal-content')?.textContent).toContain('Body');
  });

  it('open_whenTemplated_raisesTheBackdropOverTheRaisingWindow', () => {
    component.open.set(true);
    fixture.detectChanges();

    expect(backdrop.raised()).toBe(true);
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
