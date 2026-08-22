import { ChangeDetectionStrategy, Component, input, InputSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FeatureRegistry } from '@shared/angular/services/feature-registry';
import { ModalWindows } from '@shared/angular/services/modal-windows/modal-windows';
import { FakeModalWindows } from '@shared/angular/services/modal-windows/modal-windows.fake';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { Root } from './root';

/**
 * A trivial view stand-in used to register a feature with the registry in tests without pulling in a
 * real feature view and its dependencies. It declares the feature-view inputs so the registry can
 * mount it through ngComponentOutlet.
 */
@Component({
  selector: 'app-stub-view',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class StubView {
  public readonly tabId: InputSignal<string | undefined> = input<string | undefined>(undefined);
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);
}

describe('Root', () => {
  let component: Root;
  let fixture: ComponentFixture<Root>;
  let windows: FakeModalWindows;

  beforeEach(async () => {
    windows = new FakeModalWindows();
    await TestBed.configureTestingModule({
      imports: [Root],
      providers: [{ provide: ModalWindows, useValue: windows }],
    }).compileComponents();

    fixture = TestBed.createComponent(Root);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_whenNoTabsOpen_showsTheWelcomeScreenInsteadOfTheStrips', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;

    // The welcome screen stays mounted; at a cold start it shows by opening its (freestanding) modal
    // window, which the test observes through the window opener.
    expect(windows.openWindows).toBe(1);
    expect(element.querySelector('.title-strip')).toBeNull();
    expect(element.querySelector('.status-strip')).toBeNull();
  });

  it('render_whenATabIsOpen_showsTheFourLayoutStrips', () => {
    const tabs: Tabs = TestBed.inject(Tabs);
    tabs.open('terminal');
    fixture.detectChanges();

    const element: HTMLElement = fixture.nativeElement as HTMLElement;

    // Mounted but not shown (no cold-start, no modal summoned): its window is closed.
    expect(windows.openWindows).toBe(0);
    expect(element.querySelector('.title-strip')).not.toBeNull();
    expect(element.querySelector('.ribbon-strip')).not.toBeNull();
    expect(element.querySelector('.content')).not.toBeNull();
    expect(element.querySelector('.status-strip')).not.toBeNull();
  });

  it('render_whenActiveFeatureChromeOptsOut_hidesTheRibbonStrip', () => {
    // A full-bleed feature (such as settings) opts out of the ribbon through its descriptor chrome.
    const registry: FeatureRegistry = TestBed.inject(FeatureRegistry);
    registry.register({
      type: 'settings',
      view: StubView,
      chrome: { ribbon: false, status: false },
    });
    const tabs: Tabs = TestBed.inject(Tabs);
    tabs.open('settings');
    fixture.detectChanges();

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.ribbon-strip')).toBeNull();
    expect(element.querySelector('.status-strip')).toBeNull();
  });
});
