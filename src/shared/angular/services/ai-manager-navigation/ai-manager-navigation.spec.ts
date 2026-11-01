import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { AiManagerNavigation } from './ai-manager-navigation';

describe('AiManagerNavigation', () => {
  let navigation: AiManagerNavigation;
  let tabs: Tabs;

  beforeEach(() => {
    navigation = TestBed.inject(AiManagerNavigation);
    tabs = TestBed.inject(Tabs);
  });

  it('section_startsWithNothingOpen', () => {
    expect(navigation.section()).toBeNull();
  });

  it('begin_closesTheSection_unlessTheManagerWasOpenedAtOne', () => {
    navigation.show('skills');
    navigation.begin();
    expect(navigation.section()).toBeNull();

    navigation.open('profiles');
    navigation.begin();
    expect(navigation.section()).toBe('profiles');

    navigation.begin();
    expect(navigation.section()).toBeNull();
  });

  it('collapse_leavesNothingOpen', () => {
    navigation.show('models');
    navigation.collapse();

    expect(navigation.section()).toBeNull();
  });

  it('show_changesTheSectionWithoutOpeningTheTab', () => {
    navigation.show('skills');

    expect(navigation.section()).toBe('skills');
    expect(tabs.tabs().some((tab) => tab.type === 'model-manager')).toBe(false);
  });

  it('open_opensTheTabAtTheSection_andReusesItWhenOpenAgain', () => {
    navigation.open('profiles');
    navigation.open('skills');

    expect(navigation.section()).toBe('skills');
    expect(tabs.tabs().filter((tab) => tab.type === 'model-manager')).toHaveLength(1);
    expect(tabs.activeTab()?.type).toBe('model-manager');
  });
});
