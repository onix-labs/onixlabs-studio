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

  it('section_startsOnModels', () => {
    expect(navigation.section()).toBe('models');
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
