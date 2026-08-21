import { describe, expect, it } from 'vitest';
import { ChangeDetectionStrategy, Component, Injector } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FeatureRegistry } from '@shared/angular/services/feature-registry';
import { StatusBar } from '@shared/angular/services/status-bar/status-bar';
import { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { ViewInjectors } from '@shared/angular/services/view-injectors/view-injectors';
import { StatusStripContainer } from './status-strip-container';

/**
 * Stands in for a feature's status component, marked so the strip's contents can be identified.
 */
@Component({
  selector: 'app-code-status-stub',
  template: `<span class="stub">code status</span>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class CodeStatusStub {}

describe('StatusStripContainer', () => {
  let component: StatusStripContainer;
  let fixture: ComponentFixture<StatusStripContainer>;
  let tabs: Tabs;
  let registry: FeatureRegistry;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [StatusStripContainer] }).compileComponents();
    tabs = TestBed.inject(Tabs);
    registry = TestBed.inject(FeatureRegistry);
    fixture = TestBed.createComponent(StatusStripContainer);
    component = fixture.componentInstance;
  });

  /**
   * Reads the strip's rendered text, with runs of whitespace collapsed.
   * @returns Returns the strip's text content.
   */
  function text(): string {
    return ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Finds the stub feature-status component in the strip.
   * @returns Returns the stub element, or null when no feature status is mounted.
   */
  function stub(): Element | null {
    return (fixture.nativeElement as HTMLElement).querySelector('.stub');
  }

  /**
   * Opens a tab and publishes an injector for it, as a mounted feature view would.
   * @param type The tab type to open.
   * @returns Returns the opened tab.
   */
  function openViewWithInjector(type: 'code' | 'mission-control'): Tab {
    const tab: Tab = tabs.open(type);
    TestBed.inject(ViewInjectors).register(tab.id, Injector.create({ providers: [] }));
    return tab;
  }

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_whenNoTabsOpen_showsReady', () => {
    fixture.detectChanges();

    expect(text()).toContain('Ready');
  });

  it('whenTheActiveFeatureHasNoStatusComponent_namesTheActiveTab', () => {
    tabs.open('mission-control');
    fixture.detectChanges();

    expect(text()).toContain('Mission Control');
  });

  it('whenTheActiveFeatureHasAStatusComponent_mountsIt', () => {
    registry.register({ type: 'code', view: CodeStatusStub, status: CodeStatusStub });
    openViewWithInjector('code');
    fixture.detectChanges();

    expect(stub()).not.toBeNull();
  });

  it('whenTheViewHasNotPublishedAnInjector_fallsBackRatherThanMountingInTheShell', () => {
    // Mounting without the view's injector would silently bind the component to root-scoped
    // services instead of the tab's, so the strip waits for the view instead.
    registry.register({ type: 'code', view: CodeStatusStub, status: CodeStatusStub });
    tabs.open('code');
    fixture.detectChanges();

    expect(stub()).toBeNull();
  });

  it('whenAnotherTabIsActivated_theFeaturesStatusIsGone', () => {
    // The defect this split exists to prevent: a feature's status lingering over a tab that has
    // nothing to do with it.
    registry.register({ type: 'code', view: CodeStatusStub, status: CodeStatusStub });
    openViewWithInjector('code');
    fixture.detectChanges();
    expect(stub()).not.toBeNull();

    tabs.open('mission-control');
    fixture.detectChanges();

    expect(stub()).toBeNull();
    expect(text()).toContain('Mission Control');
  });

  it('ambientSegments_areShownWhicheverTabIsActive', () => {
    TestBed.inject(StatusBar).contribute('containers', [{ id: 'running', text: '2 running' }], 15);

    tabs.open('mission-control');
    fixture.detectChanges();
    expect(text()).toContain('2 running');

    tabs.open('code');
    fixture.detectChanges();
    expect(text()).toContain('2 running');
  });
});
