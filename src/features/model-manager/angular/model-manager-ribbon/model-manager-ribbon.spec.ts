import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, MockInstance, vi } from 'vitest';
import { signal } from '@angular/core';
import { ModelManagerCommands } from '../model-manager-commands/model-manager-commands';
import { ModelManagerRibbon } from './model-manager-ribbon';

/**
 * Exposes the ribbon's protected action handlers for assertion.
 */
interface Testable {
  onRefresh(): void;
  onStart(): void;
  onStop(): void;
}

describe('ModelManagerRibbon', () => {
  let fixture: ComponentFixture<ModelManagerRibbon>;
  let commands: ModelManagerCommands;

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('forwardsEachActionToTheCommandsRegistry', async () => {
    await TestBed.configureTestingModule({ imports: [ModelManagerRibbon] }).compileComponents();
    commands = TestBed.inject(ModelManagerCommands);
    const refresh: MockInstance = vi.spyOn(commands, 'refresh');
    const start: MockInstance = vi.spyOn(commands, 'start');
    const stop: MockInstance = vi.spyOn(commands, 'stop');

    fixture = TestBed.createComponent(ModelManagerRibbon);
    const ribbon: Testable = fixture.componentInstance as unknown as Testable;
    ribbon.onRefresh();
    ribbon.onStart();
    ribbon.onStop();

    expect(refresh).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('offersStartWhenStopped', async () => {
    await TestBed.configureTestingModule({ imports: [ModelManagerRibbon] }).compileComponents();
    fixture = TestBed.createComponent(ModelManagerRibbon);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Start');
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Stop');
  });

  it('offersStopWhenRunning', async () => {
    await TestBed.configureTestingModule({ imports: [ModelManagerRibbon] }).compileComponents();
    commands = TestBed.inject(ModelManagerCommands);
    commands.register({
      running: signal<boolean>(true),
      stoppable: signal<boolean>(true),
      busy: signal<boolean>(false),
      refresh: (): void => undefined,
      start: (): void => undefined,
      stop: (): void => undefined,
    });

    fixture = TestBed.createComponent(ModelManagerRibbon);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Stop');
  });
});
