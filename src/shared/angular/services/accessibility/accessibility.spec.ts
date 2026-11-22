import { TestBed } from '@angular/core/testing';
import { Settings } from '@shared/angular/services/settings/settings';
import { Accessibility } from './accessibility';

describe('Accessibility', () => {
  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-reduced-motion');
    document.documentElement.removeAttribute('data-scrollbars');
    document.documentElement.removeAttribute('data-focus-ring');
    document.documentElement.style.removeProperty('--interface-zoom');
    TestBed.resetTestingModule();
  });

  it('reducedMotion_whenOn_marksTheRoot', () => {
    const accessibility: Accessibility = TestBed.inject(Accessibility);
    TestBed.inject(Settings).assign('accessibility.reduceMotion', 'on');
    TestBed.tick();

    expect(accessibility.reducedMotion()).toBe(true);
    expect(document.documentElement.getAttribute('data-reduced-motion')).toBe('true');
  });

  it('reducedMotion_whenFollowingASystemThatDoesNotAsk_isOff', () => {
    const accessibility: Accessibility = TestBed.inject(Accessibility);
    TestBed.tick();

    expect(accessibility.reducedMotion()).toBe(false);
    expect(document.documentElement.hasAttribute('data-reduced-motion')).toBe(false);
  });

  it('colourBlindSafe_whenOn_marksTheRootAndOffClearsIt', () => {
    TestBed.inject(Accessibility);
    const settings: Settings = TestBed.inject(Settings);

    settings.assign('accessibility.colourBlindSafe', true);
    TestBed.tick();
    expect(document.documentElement.getAttribute('data-colour-blind-safe')).toBe('true');

    settings.assign('accessibility.colourBlindSafe', false);
    TestBed.tick();
    expect(document.documentElement.hasAttribute('data-colour-blind-safe')).toBe(false);
  });

  it('scrollBars_marksTheRootWithTheChoice', () => {
    TestBed.inject(Accessibility);
    TestBed.inject(Settings).assign('accessibility.scrollBars', 'always');
    TestBed.tick();

    expect(document.documentElement.getAttribute('data-scrollbars')).toBe('always');
  });

  it('focusRing_marksTheRootWithTheChoice_standardByDefault', () => {
    TestBed.inject(Accessibility);
    TestBed.tick();
    expect(document.documentElement.getAttribute('data-focus-ring')).toBe('standard');

    TestBed.inject(Settings).assign('accessibility.focusRing', 'high-visibility');
    TestBed.tick();

    expect(document.documentElement.getAttribute('data-focus-ring')).toBe('high-visibility');
  });

  it('interfaceZoom_isOneByDefault', () => {
    const accessibility: Accessibility = TestBed.inject(Accessibility);
    TestBed.tick();

    expect(accessibility.zoomFactor()).toBe(1);
    expect(document.documentElement.style.getPropertyValue('--interface-zoom')).toBe('1');
  });

  it('interfaceZoom_setsTheFactorOnTheRoot_forWhatMustKeepItsSizeOnScreen', () => {
    const accessibility: Accessibility = TestBed.inject(Accessibility);
    TestBed.inject(Settings).assign('accessibility.interfaceZoom', 75);
    TestBed.tick();

    expect(accessibility.zoomFactor()).toBe(0.75);
    expect(document.documentElement.style.getPropertyValue('--interface-zoom')).toBe('0.75');
  });

  it('interfaceZoom_storedAsSomethingThatIsNotALevel_isOne_asTheMainProcessDrawsIt', () => {
    // A stored value is read as it was written, so a hand-edited or imported 250 reaches the store.
    localStorage.setItem('settings', JSON.stringify({ 'accessibility.interfaceZoom': 250 }));
    const accessibility: Accessibility = TestBed.inject(Accessibility);
    TestBed.tick();

    expect(accessibility.zoomFactor()).toBe(1);
    expect(document.documentElement.style.getPropertyValue('--interface-zoom')).toBe('1');
  });
});
