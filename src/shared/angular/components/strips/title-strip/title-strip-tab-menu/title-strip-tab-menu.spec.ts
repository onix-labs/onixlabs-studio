import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AgentRequests } from '@shared/angular/services/agent-requests/agent-requests';
import { Settings } from '@shared/angular/services/settings/settings';
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
