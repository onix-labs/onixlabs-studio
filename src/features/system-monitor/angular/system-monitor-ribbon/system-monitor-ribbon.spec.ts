import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, MockInstance, vi } from 'vitest';
import { SystemMonitorCommands } from '../system-monitor-commands/system-monitor-commands';
import { SystemMonitorRibbon } from './system-monitor-ribbon';

/**
 * Exposes the ribbon's protected action handlers for assertion.
 */
interface Testable {
  onRefresh(): void;
  onClear(): void;
  onCopy(): void;
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
    const copy: MockInstance = vi.spyOn(commands, 'copy');

    fixture = TestBed.createComponent(SystemMonitorRibbon);
    const ribbon: Testable = fixture.componentInstance as unknown as Testable;
    ribbon.onRefresh();
    ribbon.onClear();
    ribbon.onCopy();

    expect(refresh).toHaveBeenCalledOnce();
    expect(clear).toHaveBeenCalledOnce();
    expect(copy).toHaveBeenCalledOnce();
  });
});
