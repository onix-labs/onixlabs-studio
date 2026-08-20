import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AgentRequests } from '@shared/angular/services/agent-requests/agent-requests';
import { Settings } from '@shared/angular/services/settings/settings';
import { Tab, TAB_TYPE_METADATA, TabType } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { TitleStripTabMenu } from './title-strip-tab-menu';

describe('TitleStripTabMenu', () => {
  let component: TitleStripTabMenu;
  let fixture: ComponentFixture<TitleStripTabMenu>;
  let settings: Settings;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TitleStripTabMenu],
      providers: [
        {
          provide: AgentRequests,
          useValue: {
            count: signal(1),
            tabIds: signal(new Set<string>(['tab-1'])),
            entries: signal([]),
          },
        },
      ],
    }).compileComponents();

    settings = TestBed.inject(Settings);
    fixture = TestBed.createComponent(TitleStripTabMenu);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  afterEach(() => {
    localStorage.clear();
  });

  /**
   * Reads the menu's groups from the component: its rows live in a template the CDK only instantiates
   * once the menu is open, so the DOM shows nothing until then.
   * @returns Returns the groups the menu would render.
   */
  function groups(): readonly { readonly label: string; readonly tabs: readonly Tab[] }[] {
    return (
      component as unknown as {
        groups: () => readonly { readonly label: string; readonly tabs: readonly Tab[] }[];
      }
    ).groups();
  }

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('groups_listEveryTabType_soNoOpenTabIsUnreachable', () => {
    // The menu is how a tab is reached once the strip overflows, so a type with no heading here is a
    // tab that cannot be got back to. Every type is opened and expected to land in some group.
    const tabs: Tabs = TestBed.inject(Tabs);
    const types: readonly TabType[] = Object.keys(TAB_TYPE_METADATA) as readonly TabType[];
    for (const type of types) {
      tabs.open(type);
    }
    fixture.detectChanges();

    const listed: number = groups().reduce(
      (total: number, group: { readonly tabs: readonly Tab[] }): number =>
        total + group.tabs.length,
      0,
    );
    expect(listed).toBe(types.length);
  });

  it('groups_gatherTheSingletonToolViewsUnderOneToolsHeading', () => {
    const tabs: Tabs = TestBed.inject(Tabs);
    const tools: readonly TabType[] = [
      'containers',
      'model-manager',
      'system-monitor',
      'mission-control',
      'settings',
    ];
    for (const type of tools) {
      tabs.open(type);
    }
    tabs.open('terminal');
    fixture.detectChanges();

    // One heading over five rows, rather than five headings over one row each.
    const labels: string[] = groups().map(
      (group: { readonly label: string }): string => group.label,
    );
    expect(labels).toEqual(['Terminals', 'Tools']);
    expect(
      groups().find((group: { readonly label: string }): boolean => group.label === 'Tools')?.tabs,
    ).toHaveLength(tools.length);
  });

  it('trigger_whileARequestWaits_wearsTheAlertBell', () => {
    fixture.detectChanges();

    const trigger: HTMLElement | null = (fixture.nativeElement as HTMLElement).querySelector(
      '.title-strip-tab-menu__trigger',
    );
    expect(trigger?.classList).toContain('title-strip-tab-menu__trigger--alert');
  });

  it('trigger_whenTheTabListSettingIsOff_staysAPlainChevron', () => {
    settings.set('notifications.agentRequestsInTabList', false);
    fixture.detectChanges();

    const trigger: HTMLElement | null = (fixture.nativeElement as HTMLElement).querySelector(
      '.title-strip-tab-menu__trigger',
    );
    expect(trigger?.classList).not.toContain('title-strip-tab-menu__trigger--alert');
  });
});
