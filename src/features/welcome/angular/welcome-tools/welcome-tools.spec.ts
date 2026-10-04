import { ComponentFixture, TestBed } from '@angular/core/testing';

import type { TabType } from '@shared/angular/services/tabs/tab';
import { WelcomeTools } from './welcome-tools';

describe('WelcomeTools', () => {
  let fixture: ComponentFixture<WelcomeTools>;
  let host: HTMLElement;
  let opened: TabType[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [WelcomeTools] }).compileComponents();
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
});
