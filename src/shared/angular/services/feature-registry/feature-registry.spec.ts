import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FeatureRegistry } from './feature-registry';

@Component({
  selector: 'app-stub-view',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class StubView {}

@Component({
  selector: 'app-stub-ribbon',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class StubRibbon {}

describe('FeatureRegistry', () => {
  let registry: FeatureRegistry;

  beforeEach(() => {
    registry = TestBed.inject(FeatureRegistry);
  });

  it('viewFor_whenTypeNotRegistered_returnsUndefined', () => {
    expect(registry.viewFor('terminal')).toBeUndefined();
    expect(registry.ribbonFor('terminal')).toBeUndefined();
  });

  it('register_thenLookup_returnsTheRegisteredViewAndRibbon', () => {
    registry.register({ type: 'terminal', view: StubView, ribbon: StubRibbon });

    expect(registry.viewFor('terminal')).toBe(StubView);
    expect(registry.ribbonFor('terminal')).toBe(StubRibbon);
  });

  it('chromeFor_defaultsToBothStripsVisible_andAppliesOverrides', () => {
    registry.register({
      type: 'settings',
      view: StubView,
      chrome: { ribbon: false, status: false },
    });
    registry.register({ type: 'terminal', view: StubView });

    expect(registry.chromeFor('settings')).toEqual({ ribbon: false, status: false });
    expect(registry.chromeFor('terminal')).toEqual({ ribbon: true, status: true });
  });

  it('lookup_whenTypeUndefined_treatedAsUnregistered', () => {
    expect(registry.viewFor(undefined)).toBeUndefined();
    expect(registry.ribbonFor(undefined)).toBeUndefined();
    expect(registry.chromeFor(undefined)).toEqual({ ribbon: true, status: true });
  });
});
