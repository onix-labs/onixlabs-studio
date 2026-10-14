import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import type { Skill } from '@shared/api/skill-channels';
import { AiManagerNavigation } from '@shared/angular/services/ai-manager-navigation/ai-manager-navigation';
import { PromptProfiles } from '@shared/angular/services/prompt-profiles/prompt-profiles';
import { Skills } from '@shared/angular/services/skills/skills';
import { AiManagerView } from './ai-manager-view';

describe('AiManagerView (#948)', () => {
  let fixture: ComponentFixture<AiManagerView>;
  let navigation: AiManagerNavigation;
  let skills: WritableSignal<readonly Skill[]>;

  beforeEach(() => {
    localStorage.clear();
    skills = signal<readonly Skill[]>([]);
    TestBed.configureTestingModule({
      imports: [AiManagerView],
      providers: [
        {
          provide: Skills,
          useValue: {
            skills,
            loading: signal<boolean>(false),
            reload: (): Promise<void> => Promise.resolve(),
          },
        },
      ],
    });
    navigation = TestBed.inject(AiManagerNavigation);
    // Local Models talks to the runtime; these tests are about the frame around the sub-views.
    navigation.show('profiles');
    fixture = TestBed.createComponent(AiManagerView);
    fixture.componentRef.setInput('tabId', 'tab-1');
    fixture.detectChanges();
  });

  /**
   * Gets the rendered root.
   * @returns Returns the element.
   */
  function element(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  it('showsTheSubViewTheRibbonChose_andOnlyThatOne', () => {
    expect(element().querySelector('app-prompt-profiles')).not.toBeNull();

    navigation.show('skills');
    fixture.detectChanges();

    expect(element().querySelector('app-skill-library')).not.toBeNull();
    expect(element().querySelector('app-prompt-profiles')).toBeNull();
    // The Local Models sub-view is not mounted, so it has no summary for the status strip.
    expect(fixture.componentInstance.modelSummary()).toBeNull();
  });

  it('countsTheProfilesAndSkills_andThoseSwitchedOn', () => {
    TestBed.inject(PromptProfiles).create('House style');
    skills.set([{ name: 'a', enabled: true } as Skill, { name: 'b', enabled: false } as Skill]);

    expect(fixture.componentInstance.profileCounts()).toEqual({ total: 1, enabled: 1 });
    expect(fixture.componentInstance.skillCounts()).toEqual({ total: 2, enabled: 1 });
  });

  it('hasNoProvidersSubView_providersStayInSettings', () => {
    // #948, revised: providers are configuration, not something the AI Manager looks after.
    expect(element().textContent).not.toContain('Providers');
  });
});
