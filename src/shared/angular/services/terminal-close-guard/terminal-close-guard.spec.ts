import { TestBed } from '@angular/core/testing';
import { Settings } from '@shared/angular/services/settings/settings';
import { TerminalBridge } from '@shared/angular/services/terminal-bridge/terminal-bridge';
import {
  TerminalConfirmation,
  TerminalQuestion,
} from '@shared/angular/services/terminal-confirmation/terminal-confirmation';
import { closesOnShellExit, TerminalCloseGuard } from './terminal-close-guard';

describe('closesOnShellExit', () => {
  it('keepsOpen_closes_orClosesOnlyWhenClean', () => {
    expect(closesOnShellExit('keep', 0, null)).toBe(false);
    expect(closesOnShellExit('close', 1, null)).toBe(true);
    expect(closesOnShellExit('close-if-clean', 0, null)).toBe(true);
    expect(closesOnShellExit('close-if-clean', 1, null)).toBe(false);
    // A signal-ended shell often reports 0; that is not a clean exit.
    expect(closesOnShellExit('close-if-clean', 0, 15)).toBe(false);
  });
});

describe('TerminalCloseGuard', () => {
  let foreground: Record<string, string | null>;
  let asked: TerminalQuestion[];
  let answer: boolean;
  let guard: TerminalCloseGuard;

  beforeEach(() => {
    localStorage.removeItem('settings');
    foreground = { idle: null, busy: 'npm' };
    asked = [];
    answer = true;
    TestBed.configureTestingModule({
      providers: [
        {
          provide: TerminalBridge,
          useValue: {
            foreground: (id: string): Promise<string | null> => Promise.resolve(foreground[id]),
          },
        },
        {
          provide: TerminalConfirmation,
          useValue: {
            ask: (question: TerminalQuestion): Promise<boolean> => {
              asked.push(question);
              return Promise.resolve(answer);
            },
          },
        },
      ],
    });
    guard = TestBed.inject(TerminalCloseGuard);
  });

  afterEach(() => {
    localStorage.removeItem('settings');
  });

  it('whenRunning_asksOnlyWhileAProgramRuns_andNamesIt', async () => {
    expect(await guard.mayClose(['idle'], 'zsh')).toBe(true);
    expect(asked).toEqual([]);

    answer = false;
    expect(await guard.mayClose(['busy'], 'zsh')).toBe(false);
    expect(asked[0].body).toContain('npm is still running in zsh');
  });

  it('always_asksEvenAtThePrompt_andNever_neverAsks', async () => {
    const settings: Settings = TestBed.inject(Settings);
    settings.set('terminal.confirmClose', 'always');
    expect(await guard.mayClose(['idle'], 'zsh')).toBe(true);
    expect(asked).toHaveLength(1);

    settings.set('terminal.confirmClose', 'never');
    expect(await guard.mayClose(['busy'], 'zsh')).toBe(true);
    expect(asked).toHaveLength(1);
  });
});
