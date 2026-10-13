import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import type { PluginSummary } from '@shared/api/plugin-channels';
import { PluginUpdates } from '@shared/angular/services/plugins/plugin-updates';
import type { TabType } from '@shared/angular/services/tabs/tab';
import { WelcomeTools } from './welcome-tools';

describe('WelcomeTools', () => {
  let fixture: ComponentFixture<WelcomeTools>;
  let host: HTMLElement;
  let opened: TabType[];
  let waiting: WritableSignal<readonly PluginSummary[]>;

  beforeEach(async () => {
    waiting = signal<readonly PluginSummary[]>([]);
    await TestBed.configureTestingModule({
      imports: [WelcomeTools],
      providers: [{ provide: PluginUpdates, useValue: { available: waiting.asReadonly() } }],
    }).compileComponents();
    fixture = TestBed.createComponent(WelcomeTools);
    opened = [];
    fixture.componentInstance.openTab.subscribe((type: TabType): void => void opened.push(type));
    await fixture.whenStable();
    host = fixture.nativeElement as HTMLElement;
  });

  /**
   * Clicks the card with the given title.
   * @param title The card's title.
   */
  function clickCard(title: string): void {
    Array.from(host.querySelectorAll<HTMLButtonElement>('.welcome__tool'))
      .find(
        (card: HTMLButtonElement): boolean =>
          card.querySelector('.welcome__tool-title')?.textContent?.trim() === title,
      )
      ?.click();
  }

  it('cards_areTheSixTools_inOrder', () => {
    expect(
      Array.from(host.querySelectorAll<HTMLElement>('.welcome__tool-title')).map(
        (title: HTMLElement): string => title.textContent.trim(),
      ),
    ).toEqual([
      'Containers',
      'Orchestration',
      'AI Model Manager',
      'System Monitor',
      'Plugin Manager',
      'Settings',
    ]);
  });

  it('aCard_asksForItsTool', () => {
    clickCard('Containers');
    clickCard('AI Model Manager');
    clickCard('System Monitor');
    clickCard('Plugin Manager');
    clickCard('Settings');

    expect(opened).toEqual([
      'containers',
      'model-manager',
      'system-monitor',
      'plugin-manager',
      'settings',
    ]);
  });

  it('aToolThatDoesNotExistYet_opensNothing_andLooksIt', () => {
    clickCard('Orchestration');

    expect(opened).toEqual([]);
    expect(host.querySelector('.welcome__tool--unavailable')?.textContent).toContain(
      'Orchestration',
    );
  });

  it('noUpdatesWaiting_showsNoChip', () => {
    expect(host.querySelector('.welcome__tool-chip')).toBeNull();
  });

  it('updatesWaiting_putACountChipOnThePluginManagerCard', async () => {
    waiting.set([{ id: 'a' }, { id: 'b' }] as unknown as readonly PluginSummary[]);
    await fixture.whenStable();

    const chips: HTMLElement[] = Array.from(
      host.querySelectorAll<HTMLElement>('.welcome__tool-chip'),
    );
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent.trim()).toBe('2 updates');
    expect(chips[0].closest('.welcome__tool')?.textContent).toContain('Plugin Manager');
  });

  it('oneUpdateWaiting_saysSoInTheSingular', async () => {
    waiting.set([{ id: 'a' }] as unknown as readonly PluginSummary[]);
    await fixture.whenStable();

    expect(host.querySelector('.welcome__tool-chip')?.textContent.trim()).toBe('1 update');
  });
});
