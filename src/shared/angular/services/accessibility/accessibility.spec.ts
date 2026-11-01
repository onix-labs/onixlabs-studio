import { TestBed } from '@angular/core/testing';
import { Settings } from '@shared/angular/services/settings/settings';
import { Accessibility } from './accessibility';

describe('Accessibility', () => {
  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-reduced-motion');
    document.documentElement.removeAttribute('data-scrollbars');
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

  it('scrollBars_marksTheRootWithTheChoice', () => {
    TestBed.inject(Accessibility);
    TestBed.inject(Settings).assign('accessibility.scrollBars', 'always');
    TestBed.tick();

    expect(document.documentElement.getAttribute('data-scrollbars')).toBe('always');
  });
});
