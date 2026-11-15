import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, MockInstance, vi } from 'vitest';
import { signal, WritableSignal } from '@angular/core';
import { SystemMonitorCommands } from '../system-monitor-commands/system-monitor-commands';
import { SystemMonitorTabId } from '../tabs/system-monitor-tab-id';
import { SystemMonitorRibbon } from './system-monitor-ribbon';

/**
 * Exposes the ribbon's protected action handlers for assertion.
 */
interface Testable {
  onRefresh(): void;
  onClear(): void;
}

describe('SystemMonitorRibbon', () => {
  let fixture: ComponentFixture<SystemMonitorRibbon>;
  let commands: SystemMonitorCommands;

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('forwardsEachActionToTheCommandsRegistry', async () => {
    await TestBed.configureTestingModule({ imports: [SystemMonitorRibbon] }).compileComponents();
    commands = TestBed.inject(SystemMonitorCommands);
    const refresh: MockInstance = vi.spyOn(commands, 'refresh');
    const clear: MockInstance = vi.spyOn(commands, 'clearFilters');

    fixture = TestBed.createComponent(SystemMonitorRibbon);
    const ribbon: Testable = fixture.componentInstance as unknown as Testable;
    ribbon.onRefresh();
    ribbon.onClear();

    expect(refresh).toHaveBeenCalledOnce();
    expect(clear).toHaveBeenCalledOnce();
  });

  describe('the View group', () => {
    let tab: WritableSignal<SystemMonitorTabId>;
    let host: HTMLElement;

    /**
     * Gets the labels of the ribbon's buttons, in order.
     * @returns Returns the labels.
     */
    function labels(): string[] {
      return Array.from(host.querySelectorAll('button')).map(
        (button: HTMLButtonElement): string => button.textContent?.trim() ?? '',
      );
    }

    /**
     * Finds a ribbon button by its label.
     * @param label The label.
     * @returns Returns the button.
     */
    function button(label: string): HTMLButtonElement {
      const match: HTMLButtonElement | undefined = Array.from(
        host.querySelectorAll<HTMLButtonElement>('button'),
      ).find((element: HTMLButtonElement): boolean => element.textContent?.trim() === label);
      if (match === undefined) {
        throw new Error(`No button labelled "${label}"`);
      }
      return match;
    }

    beforeEach(async () => {
      await TestBed.configureTestingModule({ imports: [SystemMonitorRibbon] }).compileComponents();
      commands = TestBed.inject(SystemMonitorCommands);
      tab = signal<SystemMonitorTabId>(SystemMonitorTabId.Overview);
      commands.register({
        agentShown: signal<boolean>(false),
        tab,
        selectTab: (next: SystemMonitorTabId): void => tab.set(next),
        toggleAgent: vi.fn(),
        refresh: vi.fn(),
        clearFilters: vi.fn(),
      });
      fixture = TestBed.createComponent(SystemMonitorRibbon);
      host = fixture.nativeElement as HTMLElement;
      fixture.detectChanges();
      await fixture.whenStable();
    });

    it('offersEveryView_andPressesTheOneShowing', () => {
      expect(labels().slice(0, 8)).toEqual([
        'Overview',
        'CPU',
        'Memory',
        'GPU',
        'Processes',
        'Storage',
        'Network',
        'Logs',
      ]);
      expect(button('Overview').getAttribute('aria-pressed')).toBe('true');
      expect(button('CPU').getAttribute('aria-pressed')).toBe('false');
    });

    it('switchesTheView_whenAButtonIsPressed', async () => {
      button('Storage').click();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(tab()).toBe(SystemMonitorTabId.Storage);
      expect(button('Storage').getAttribute('aria-pressed')).toBe('true');
    });

    it('offersOnlyTheViewsAndTheAgent_evenOnTheLogsView', async () => {
      tab.set(SystemMonitorTabId.Logs);
      fixture.detectChanges();
      await fixture.whenStable();

      // The logs' refresh, filters and copy are in the Logs view's header, not the ribbon. (The
      // ribbon's own overflow button has no label.)
      expect(labels().filter((label: string): boolean => label.length > 0)).toEqual([
        'Overview',
        'CPU',
        'Memory',
        'GPU',
        'Processes',
        'Storage',
        'Network',
        'Logs',
        'Agent',
      ]);
    });
  });
});
