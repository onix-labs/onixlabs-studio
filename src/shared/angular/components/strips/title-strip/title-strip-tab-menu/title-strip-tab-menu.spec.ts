import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AgentRequests } from '@shared/angular/services/agent-requests/agent-requests';
import { Settings } from '@shared/angular/services/settings/settings';
import { TAB_TYPE_METADATA, TabType } from '@shared/angular/services/tabs/tab';
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

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('groups_listEveryTabType_soNoOpenTabIsUnreachable', () => {
    // The menu is how a tab is reached once the strip overflows, so a type with no heading here is a
    // tab that cannot be got back to. Every type is opened and expected under a heading of its own.
    const tabs: Tabs = TestBed.inject(Tabs);
    const types: readonly TabType[] = Object.keys(TAB_TYPE_METADATA) as readonly TabType[];
    for (const type of types) {
      tabs.open(type);
    }
    fixture.detectChanges();

    // The groups are read from the component rather than the DOM: the menu's rows live in a template
    // the CDK only instantiates once the menu is open.
    const groups: readonly { readonly label: string }[] = (
      component as unknown as { groups: () => readonly { readonly label: string }[] }
    ).groups();
    expect(groups.map((group: { readonly label: string }): string => group.label)).toHaveLength(
      types.length,
    );
    expect(groups.map((group: { readonly label: string }): string => group.label)).toContain(
      'API Explorers',
    );
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
