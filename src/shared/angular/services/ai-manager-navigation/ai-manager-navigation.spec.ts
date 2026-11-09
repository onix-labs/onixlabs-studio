import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, beforeEach } from 'vitest';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { AiManagerNavigation } from './ai-manager-navigation';

describe('AiManagerNavigation', () => {
  let navigation: AiManagerNavigation;
  let tabs: Tabs;

  beforeEach(() => {
    localStorage.removeItem('settings');
    navigation = TestBed.inject(AiManagerNavigation);
    tabs = TestBed.inject(Tabs);
  });

  afterEach(() => {
    localStorage.removeItem('settings');
  });

  it('section_startsWithNothingOpen', () => {
    expect(navigation.section()).toBeNull();
  });

  it('begin_opensWhereItWasLeft', () => {
    navigation.show('skills');
    navigation.collapse();
    navigation.show('profiles');

    navigation.begin();

    expect(navigation.section()).toBe('profiles');
  });

  it('begin_leavesNothingOpen_whenItWasLeftThatWay', () => {
    navigation.show('skills');
    navigation.collapse();

    navigation.begin();

    expect(navigation.section()).toBeNull();
  });

  it('begin_keepsTheSectionItWasOpenedAt', () => {
    navigation.show('skills');
    navigation.open('profiles');

    navigation.begin();

    expect(navigation.section()).toBe('profiles');
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
