import { ChangeDetectionStrategy, Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { Skill } from '@shared/api/skill-channels';
import { AiManagerNavigation } from '@shared/angular/services/ai-manager-navigation/ai-manager-navigation';
import { Skills } from '@shared/angular/services/skills/skills';
import { AiManagerSidebar } from './ai-manager-sidebar';
import { AiManagerSidebarState } from './ai-manager-sidebar-state';

/**
 * Hosts the sidebar with its state, as the AI Manager view does.
 */
@Component({
  selector: 'app-sidebar-host',
  imports: [AiManagerSidebar],
  providers: [AiManagerSidebarState],
  template: '<app-ai-manager-sidebar />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class SidebarHost {}

describe('AiManagerSidebar', () => {
  let fixture: ComponentFixture<SidebarHost>;
  let navigation: AiManagerNavigation;
  const skills: WritableSignal<readonly Skill[]> = signal<readonly Skill[]>([]);

  beforeEach(async () => {
    skills.set([
      { name: 'gdpr', enabled: true } as Skill,
      { name: 'acid', enabled: true } as Skill,
    ]);
    await TestBed.configureTestingModule({
      imports: [SidebarHost],
      providers: [{ provide: Skills, useValue: { skills, loading: signal(false) } }],
    }).compileComponents();
    navigation = TestBed.inject(AiManagerNavigation);
    fixture = TestBed.createComponent(SidebarHost);
    await fixture.whenStable();
  });

  /**
   * Gets the section headings shown, with whether each is open.
   * @returns Returns the headings.
   */
  function headings(): string[] {
    return [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
        '.accordion__header',
      ),
    ].map(
      (header: HTMLButtonElement): string =>
        `${header.textContent?.trim()}${header.getAttribute('aria-expanded') === 'true' ? ' (open)' : ''}`,
    );
  }

  /**
   * Clicks a section heading.
   * @param label The heading.
   */
  async function click(label: string): Promise<void> {
    [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
        '.accordion__header',
      ),
    ]
      .find((header: HTMLButtonElement): boolean => header.textContent?.trim() === label)
      ?.click();
    await fixture.whenStable();
  }

  it('sections_oneOpenAtATime_openingOneShowsIt', async () => {
    expect(headings()).toEqual(['Local Models (open)', 'Prompt Profiles', 'Skills']);

    await click('Skills');

    expect(navigation.section()).toBe('skills');
    expect(headings()).toEqual(['Local Models', 'Prompt Profiles', 'Skills (open)']);
  });

  it('sections_followTheSectionShownFromElsewhere', async () => {
    navigation.show('profiles');
    await fixture.whenStable();

    expect(headings()).toEqual(['Local Models', 'Prompt Profiles (open)', 'Skills']);
  });

  it('search_hidesALibrarySectionWithNoMatches_andCountsTheMatches', async () => {
    fixture.debugElement.injector.get(AiManagerSidebarState).query.set('gdp');
    await fixture.whenStable();

    expect(headings()).toEqual(['Local Models (open)', 'Skills']);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.sidebar__count')?.textContent?.trim(),
    ).toBe('1');
  });
});
