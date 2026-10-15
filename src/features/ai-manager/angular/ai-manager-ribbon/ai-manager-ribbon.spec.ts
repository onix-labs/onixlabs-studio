import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, Mock, vi } from 'vitest';
import type { Skill } from '@shared/api/skill-channels';
import {
  AiManagerNavigation,
  AiManagerSection,
} from '@shared/angular/services/ai-manager-navigation/ai-manager-navigation';
import { Skills } from '@shared/angular/services/skills/skills';
import {
  AiLibraryCommandHandler,
  AiLibraryCommands,
} from '../ai-library-commands/ai-library-commands';
import {
  ModelManagerCommandHandler,
  ModelManagerCommands,
} from '../model-manager-commands/model-manager-commands';
import { AiManagerAgentPanelState } from '../ai-manager-agent/ai-manager-agent-panel-state';
import { AiManagerRibbon } from './ai-manager-ribbon';

/**
 * Builds a Local Models handler for the ribbon to read, in a given runtime state.
 * @param state What the runtime is doing.
 * @returns Returns the handler and the calls made through it.
 */
function modelsHandler(state: { running?: boolean; needsInstall?: boolean } = {}): {
  handler: ModelManagerCommandHandler;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    handler: {
      running: signal<boolean>(state.running ?? false),
      stoppable: signal<boolean>(true),
      busy: signal<boolean>(false),
      needsInstall: signal<boolean>(state.needsInstall ?? false),
      refresh: (): void => void calls.push('refresh'),
      start: (): void => void calls.push('start'),
      stop: (): void => void calls.push('stop'),
      installRuntime: (): void => void calls.push('install'),
    },
  };
}

describe('AiManagerRibbon (#948)', () => {
  let fixture: ComponentFixture<AiManagerRibbon>;
  let navigation: AiManagerNavigation;
  let openLibrary: Mock<() => Promise<void>>;
  let reload: Mock<() => Promise<void>>;

  beforeEach(() => {
    openLibrary = vi.fn<() => Promise<void>>(() => Promise.resolve());
    reload = vi.fn<() => Promise<void>>(() => Promise.resolve());
    TestBed.configureTestingModule({
      imports: [AiManagerRibbon],
      providers: [
        {
          provide: Skills,
          useValue: {
            openLibrary,
            reload,
            skills: signal<readonly Skill[]>([]),
            loading: signal<boolean>(false),
          },
        },
      ],
    });
    navigation = TestBed.inject(AiManagerNavigation);
  });

  /**
   * Shows the ribbon for a sub-view.
   * @param section The sub-view shown.
   */
  function mount(section: AiManagerSection): void {
    navigation.show(section);
    fixture = TestBed.createComponent(AiManagerRibbon);
    fixture.detectChanges();
  }

  /**
   * Gets the ribbon's button labels.
   * @returns Returns the labels.
   */
  function labels(): string[] {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('app-ribbon-strip-button'),
      (button: Element) => button.textContent?.trim() ?? '',
    );
  }

  /**
   * Clicks the ribbon button with a label.
   * @param label The button's label.
   */
  function press(label: string): void {
    Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
        'app-ribbon-strip-button button',
      ),
    )
      .find((button: HTMLElement) => button.textContent?.trim() === label)
      ?.click();
    fixture.detectChanges();
  }

  /**
   * Gets the labels of the pressed toggles.
   * @returns Returns the labels.
   */
  function pressed(): string[] {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('[aria-pressed="true"]'),
      (button: HTMLElement) => button.textContent?.trim() ?? '',
    );
  }

  it('view_chooseTheSubView_andShowsWhichIsShown', () => {
    mount('models');
    expect(pressed()).toEqual(['Local Models']);

    press('Skills');

    expect(navigation.section()).toBe('skills');
    expect(pressed()).toEqual(['Skills']);
  });

  it('localModels_offerStartWhenStopped_andForwardTheRuntimeActions', () => {
    const { handler, calls } = modelsHandler();
    TestBed.inject(ModelManagerCommands).register(handler);
    mount('models');

    expect(labels()).toEqual([
      'Local Models',
      'Prompt Profiles',
      'Skills',
      'Start',
      'Refresh',
      'Agent',
    ]);
    press('Start');
    press('Refresh');
    expect(calls).toEqual(['start', 'refresh']);
  });

  it('localModels_offerStopWhenRunning_andInstallWhenTheRuntimeIsAbsent', () => {
    const commands: ModelManagerCommands = TestBed.inject(ModelManagerCommands);
    const running: { handler: ModelManagerCommandHandler; calls: string[] } = modelsHandler({
      running: true,
    });
    commands.register(running.handler);
    mount('models');
    expect(labels()).toContain('Stop');
    press('Stop');
    expect(running.calls).toEqual(['stop']);

    const absent: { handler: ModelManagerCommandHandler; calls: string[] } = modelsHandler({
      needsInstall: true,
    });
    commands.register(absent.handler);
    fixture.detectChanges();
    expect(labels()).toContain('Install');
    expect(labels()).not.toContain('Start');
    press('Install');
    expect(absent.calls).toEqual(['install']);
  });

  it('profiles_newProfile_reachesTheShownSubView', () => {
    const add: Mock<() => void> = vi.fn<() => void>();
    const handler: AiLibraryCommandHandler = { add };
    TestBed.inject(AiLibraryCommands).register('profiles', handler);
    mount('profiles');

    expect(labels()).toEqual(['Local Models', 'Prompt Profiles', 'Skills', 'New Profile', 'Agent']);
    press('New Profile');
    expect(add).toHaveBeenCalledTimes(1);
  });

  it('skills_newAndImportReachTheSubView_andTheLibraryButtonsActOnItDirectly', () => {
    const add: Mock<() => void> = vi.fn<() => void>();
    const importFrom: Mock<() => void> = vi.fn<() => void>();
    TestBed.inject(AiLibraryCommands).register('skills', { add, importFrom });
    mount('skills');

    expect(labels()).toEqual([
      'Local Models',
      'Prompt Profiles',
      'Skills',
      'New Skill',
      'Import',
      'Open Folder',
      'Refresh',
      'Agent',
    ]);
    press('New Skill');
    press('Import');
    press('Open Folder');
    press('Refresh');

    expect(add).toHaveBeenCalledTimes(1);
    expect(importFrom).toHaveBeenCalledTimes(1);
    expect(openLibrary).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('agent_isTheLastButton_andTogglesTheDockedAgent', () => {
    // #967: the Agent group goes last on every tool view's ribbon.
    mount('profiles');
    const state: AiManagerAgentPanelState = TestBed.inject(AiManagerAgentPanelState);
    expect(labels().at(-1)).toBe('Agent');
    expect(state.visible()).toBe(false);

    press('Agent');

    expect(state.visible()).toBe(true);
    expect(state.mounted()).toBe(true);
  });
});
