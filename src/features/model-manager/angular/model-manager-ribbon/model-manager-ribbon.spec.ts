import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, MockInstance, vi } from 'vitest';
import { signal } from '@angular/core';
import {
  ModelGroupId,
  ModelManagerCommandHandler,
  ModelManagerCommands,
} from '../model-manager-commands/model-manager-commands';
import { ModelManagerRibbon } from './model-manager-ribbon';

/**
 * Builds a handler for the ribbon to read, in a given runtime state.
 * @param state What the runtime is doing.
 * @returns Returns the handler.
 */
function handler(
  state: { running?: boolean; needsInstall?: boolean } = {},
): ModelManagerCommandHandler {
  return {
    running: signal<boolean>(state.running ?? false),
    stoppable: signal<boolean>(true),
    busy: signal<boolean>(false),
    needsInstall: signal<boolean>(state.needsInstall ?? false),
    shownGroup: signal<ModelGroupId | null>('available'),
    // Nothing is loaded, so Loaded has no box to open.
    presentGroups: signal<readonly ModelGroupId[]>(['installed', 'available']),
    searchText: signal<string>(''),
    refresh: (): void => undefined,
    start: (): void => undefined,
    stop: (): void => undefined,
    installRuntime: (): void => undefined,
    openGroup: (): void => undefined,
    search: (): void => undefined,
  };
}

/**
 * Exposes the ribbon's protected action handlers for assertion.
 */
interface Testable {
  onRefresh(): void;
  onStart(): void;
  onStop(): void;
  onInstall(): void;
  onGroup(group: ModelGroupId): void;
  onSearch(text: string): void;
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
    commands.register(handler({ running: true }));

    fixture = TestBed.createComponent(ModelManagerRibbon);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Stop');
  });

  it('offersInstallInPlaceOfStart_whenTheRuntimeIsAbsent', async () => {
    await TestBed.configureTestingModule({ imports: [ModelManagerRibbon] }).compileComponents();
    commands = TestBed.inject(ModelManagerCommands);
    commands.register(handler({ needsInstall: true }));

    fixture = TestBed.createComponent(ModelManagerRibbon);
    fixture.detectChanges();

    const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Install');
    expect(text).not.toContain('Start');
  });

  it('pressesTheOpenGroup_andForwardsGroupInstallAndSearch', async () => {
    await TestBed.configureTestingModule({ imports: [ModelManagerRibbon] }).compileComponents();
    commands = TestBed.inject(ModelManagerCommands);
    commands.register(handler({ running: true }));
    const install: MockInstance = vi.spyOn(commands, 'installRuntime');
    const open: MockInstance = vi.spyOn(commands, 'openGroup');
    const search: MockInstance = vi.spyOn(commands, 'search');

    fixture = TestBed.createComponent(ModelManagerRibbon);
    fixture.detectChanges();
    const pressed: string[] = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
        '[aria-pressed="true"]',
      ),
    ].map((button: HTMLElement): string => button.textContent?.trim() ?? '');
    expect(pressed).toEqual(['Available']);
    const loaded: HTMLButtonElement | undefined = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
    ].find((button: HTMLButtonElement): boolean => button.textContent?.trim() === 'Loaded');
    expect(loaded?.disabled).toBe(true);

    const ribbon: Testable = fixture.componentInstance as unknown as Testable;
    ribbon.onInstall();
    ribbon.onGroup('loaded');
    ribbon.onSearch('qwen');
    expect(install).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith('loaded');
    expect(search).toHaveBeenCalledWith('qwen');
  });
});
