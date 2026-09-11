import { OverlayContainer } from '@angular/cdk/overlay';
import { Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Settings } from '@shared/angular/services/settings/settings';
import { TooltipTrigger } from './tooltip-trigger';

/**
 * A host carrying a control that names itself in a bubble, as an icon-only control does.
 */
@Component({
  imports: [TooltipTrigger],
  template: `<button
    type="button"
    [disabled]="disabled()"
    [appTooltip]="name()"
    [appTooltipDisabled]="disabled()"
  >
    icon
  </button>`,
})
class TooltipHost {
  public readonly name: WritableSignal<string | undefined> = signal<string | undefined>('New chat');
  public readonly disabled: WritableSignal<boolean> = signal<boolean>(false);
}

/**
 * Stands in for a control mounted in a secondary window — a modal, a popped-out dock. Such a host
 * provides its own CDK overlay layer (see `windowScopedCdkProviders`), and everything inside it must
 * use that one rather than the application's root container.
 */
@Component({
  imports: [TooltipTrigger],
  selector: 'app-scoped-window',
  template: `<button type="button" appTooltip="Scoped">icon</button>`,
  providers: [OverlayContainer],
})
class ScopedWindowHost {}

describe('TooltipTrigger', () => {
  let fixture: ComponentFixture<TooltipHost>;
  let settings: Settings;

  /**
   * Gets the control the tooltip is attached to.
   * @returns Returns the button element.
   */
  function control(): HTMLElement {
    return (fixture.nativeElement as HTMLElement).querySelector('button')!;
  }

  /**
   * Reads the text of the open bubble, which renders in the overlay outside the fixture.
   * @returns Returns the bubble's text, or null when no bubble is open.
   */
  function bubbleText(): string | null {
    return document.querySelector('app-tooltip')?.textContent?.trim() ?? null;
  }

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ imports: [TooltipHost] });
    settings = TestBed.inject(Settings);
    fixture = TestBed.createComponent(TooltipHost);
    fixture.detectChanges();
  });

  afterEach(() => {
    // The bubble lives in an overlay outside the fixture, so a leaked one would be visible to the
    // next test's document query.
    fixture.destroy();
  });

  it('hover_inASecondaryWindow_drawsTheBubbleInThatWindowsOverlayContainer', () => {
    // 🔥 The bubble used to be built from the `Overlay` service, which is `providedIn: 'root'` and so
    // captures the ROOT container and the ROOT viewport ruler once and keeps them. A control inside a
    // modal therefore had its tooltip drawn in the MAIN window and positioned against the MAIN
    // window's viewport — offset, and behind a modal that is a separate OS window.
    const scoped: ComponentFixture<ScopedWindowHost> = TestBed.createComponent(ScopedWindowHost);
    scoped.detectChanges();
    const container: OverlayContainer = scoped.debugElement.injector.get(OverlayContainer);
    const root: OverlayContainer = TestBed.inject(OverlayContainer);
    // The premise: the host really does have a container of its own to be wrong about.
    expect(container).not.toBe(root);

    (scoped.nativeElement as HTMLElement)
      .querySelector('button')!
      .dispatchEvent(new MouseEvent('mouseenter'));
    scoped.detectChanges();

    expect(container.getContainerElement().querySelector('app-tooltip')?.textContent?.trim()).toBe(
      'Scoped',
    );
    expect(root.getContainerElement().querySelector('app-tooltip')).toBeNull();
    scoped.destroy();
  });

  it('hover_whenTheControlIsNamed_showsTheNameAtOnce', () => {
    // No dwell: the name is what the control was unable to say for itself, so waiting for it means
    // waiting to find out what you are pointing at.
    control().dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();

    expect(bubbleText()).toBe('New chat');
  });

  it('mouseleave_whenShowing_takesTheBubbleAway', () => {
    control().dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();

    control().dispatchEvent(new MouseEvent('mouseleave'));
    fixture.detectChanges();

    expect(bubbleText()).toBeNull();
  });

  it('focus_whenTheControlIsNamed_showsTheNameBeneathIt', () => {
    control().dispatchEvent(new FocusEvent('focus'));
    fixture.detectChanges();

    expect(bubbleText()).toBe('New chat');
  });

  it('blur_whenShowing_takesTheBubbleAway', () => {
    control().dispatchEvent(new FocusEvent('focus'));
    fixture.detectChanges();
    expect(bubbleText()).toBe('New chat');

    control().dispatchEvent(new FocusEvent('blur'));
    fixture.detectChanges();

    expect(bubbleText()).toBeNull();
  });

  it('click_whenShowing_takesTheBubbleAway', () => {
    // A control that has been pressed has answered for itself; the bubble would only be in the way of
    // whatever the press opened.
    control().dispatchEvent(new FocusEvent('focus'));
    fixture.detectChanges();

    control().click();
    fixture.detectChanges();

    expect(bubbleText()).toBeNull();
  });

  it('focus_whenTooltipsAreTurnedOff_showsNothing', () => {
    settings.set('accessibility.showTooltips', false);
    fixture.detectChanges();

    control().dispatchEvent(new FocusEvent('focus'));
    fixture.detectChanges();

    expect(bubbleText()).toBeNull();
  });

  it('focus_whenTheControlHasNoName_showsNothing', () => {
    // The bubble states the control's accessible name; one with none has nothing to say here either.
    fixture.componentInstance.name.set(undefined);
    fixture.detectChanges();

    control().dispatchEvent(new FocusEvent('focus'));
    fixture.detectChanges();

    expect(bubbleText()).toBeNull();
  });

  it('focus_whenTheNameIsOnlyWhitespace_showsNothing', () => {
    fixture.componentInstance.name.set('   ');
    fixture.detectChanges();

    control().dispatchEvent(new FocusEvent('focus'));
    fixture.detectChanges();

    expect(bubbleText()).toBeNull();
  });

  it('focus_whenAlreadyShowing_doesNotStackASecondBubble', () => {
    control().dispatchEvent(new FocusEvent('focus'));
    control().dispatchEvent(new FocusEvent('focus'));
    fixture.detectChanges();

    expect(document.querySelectorAll('app-tooltip').length).toBe(1);
  });

  it('destroy_whileShowing_takesTheBubbleWithTheControl', () => {
    // A toolbar that re-lays out under the pointer destroys the control; the overlay would outlive it.
    control().dispatchEvent(new FocusEvent('focus'));
    fixture.detectChanges();
    expect(bubbleText()).toBe('New chat');

    fixture.destroy();

    expect(bubbleText()).toBeNull();
  });

  it('hover_whenTheControlIsDisabled_showsNothing', () => {
    fixture.componentInstance.disabled.set(true);
    fixture.detectChanges();

    control().dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();

    expect(bubbleText()).toBeNull();
  });

  it('disabling_whileTheBubbleIsShowing_takesItAway', () => {
    // No mouseleave is coming: a browser stops sending a control mouse events the moment it is
    // disabled, so a control that disables itself under the pointer would wear its name for ever.
    control().dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();
    expect(bubbleText()).toBe('New chat');

    fixture.componentInstance.disabled.set(true);
    fixture.detectChanges();
    TestBed.tick();

    expect(bubbleText()).toBeNull();
  });

  it('showTooltips_byDefault_isOn', () => {
    // The setting exists to turn the names off, not to have to turn them on.
    expect(settings.value('accessibility.showTooltips')()).toBe(true);
  });
});
