import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { vi } from 'vitest';
import { Icon } from '@shared/angular/icons/icon';
import { Terminal } from '@shared/angular/components/terminal/terminal';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { DockTabContext } from '@shared/angular/services/dock-layout/dock-tab-context';
import { TerminalBridge } from '@shared/angular/services/terminal-bridge/terminal-bridge';
import {
  TerminalSession,
  TerminalSessions,
} from '@shared/angular/services/terminal-sessions/terminal-sessions';
import { AccentColor, ResolvedThemeMode, Theme } from '@shared/angular/services/theme/theme';
import { TerminalPanel } from './terminal-panel';

/**
 * The dock panel descriptor the terminal panel is projected for.
 */
const PANEL: DockPanel = {
  id: 'terminal',
  title: 'Terminal',
  icon: Icon.TERMINAL,
  role: 'tool',
  component: TerminalPanel,
};

describe('TerminalPanel', () => {
  let fixture: ComponentFixture<TerminalPanel>;
  let context: DockTabContext;
  let host: HTMLElement;
  let dispose: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    dispose = vi.fn((): Promise<boolean> => Promise.resolve(true));
    await TestBed.configureTestingModule({
      imports: [TerminalPanel],
      providers: [
        // The embedded Terminal spawns its PTY through this seam; reporting a non-Electron host keeps
        // it from creating an xterm session, so the panel can be exercised in jsdom.
        {
          provide: TerminalBridge,
          useValue: {
            isElectron: false,
            dispose,
            onData: (): (() => void) => (): void => undefined,
            onExit: (): (() => void) => (): void => undefined,
          },
        },
        {
          provide: Theme,
          useValue: {
            resolvedMode: signal<ResolvedThemeMode>('dark'),
            accent: signal<AccentColor>('blue'),
          },
        },
      ],
    }).compileComponents();

    context = TestBed.inject(DockTabContext);
    fixture = TestBed.createComponent(TerminalPanel);
    fixture.componentRef.setInput('panel', PANEL);
    host = fixture.nativeElement as HTMLElement;
  });

  it('render_whenNoFolderIsOpen_showsTheOpenFolderPrompt', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host.querySelector('.terminal-panel__empty')?.textContent).toContain(
      'Open a folder to use the terminal.',
    );
    expect(host.querySelector('app-terminal')).toBeNull();
  });

  it('render_whenARootIsKnown_opensOneTerminalRootedAtTheFolder', async () => {
    context.setTabId('tab-1');
    context.setRoot('/repo');
    fixture.detectChanges();
    await fixture.whenStable();

    const terminals: Terminal[] = fixture.debugElement
      .queryAll(By.directive(Terminal))
      .map((element): Terminal => element.componentInstance as Terminal);
    expect(terminals).toHaveLength(1);
    expect(terminals[0].terminalId()).toMatch(/^term-/);
    expect(terminals[0].cwd()).toBe('/repo');
    expect(host.querySelector('.terminal-panel__empty')).toBeNull();
    expect(host.querySelector('.terminal-panel__tabs')).not.toBeNull();
  });

  it('newTerminal_mountsAnAdditionalConcurrentTerminalWithADistinctSession', async () => {
    context.setTabId('tab-1');
    context.setRoot('/repo');
    fixture.detectChanges();
    await fixture.whenStable();

    host.querySelector<HTMLButtonElement>('button[aria-label="New Terminal"]')!.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const terminals: Terminal[] = fixture.debugElement
      .queryAll(By.directive(Terminal))
      .map((element): Terminal => element.componentInstance as Terminal);
    // Both terminals stay mounted (only one visible), so switching never tears a session down.
    expect(terminals).toHaveLength(2);
    expect(terminals[0].terminalId()).not.toBe(terminals[1].terminalId());
    expect(host.querySelectorAll('.terminal-panel__tab')).toHaveLength(2);
  });

  it('render_whenOutsideElectron_theHostedTerminalShowsItsUnavailableNotice', async () => {
    context.setTabId('tab-1');
    context.setRoot('/repo');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host.textContent).toContain('Terminal is only available when running inside Electron.');
  });

  it('root_whenTheFolderCloses_revertsToThePromptAndDisposesTheSessions', async () => {
    context.setTabId('tab-1');
    context.setRoot('/repo');
    fixture.detectChanges();
    await fixture.whenStable();
    const sessions: TerminalSessions = TestBed.inject(TerminalSessions);
    const id: string = sessions.sessions()[0].id;

    context.setRoot(null);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host.querySelector('app-terminal')).toBeNull();
    expect(host.querySelector('.terminal-panel__empty')).not.toBeNull();
    expect(dispose).toHaveBeenCalledWith(id);
  });

  it('destroy_leavesTheSessionsAliveForTheNextPanelToReAttach', async () => {
    context.setTabId('tab-1');
    context.setRoot('/repo');
    fixture.detectChanges();
    await fixture.whenStable();
    const sessions: TerminalSessions = TestBed.inject(TerminalSessions);
    host.querySelector<HTMLButtonElement>('button[aria-label="New Terminal"]')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    const ids: readonly string[] = sessions.sessions().map((s: TerminalSession): string => s.id);
    expect(ids).toHaveLength(2);

    // A tool-tab switch destroys the panel; its persistent panes must detach, not dispose.
    fixture.destroy();
    expect(dispose).not.toHaveBeenCalled();
    expect(sessions.sessions().map((s: TerminalSession): string => s.id)).toEqual(ids);

    // A re-created panel (the tool tab switching back) renders the same sessions again.
    const revived: ComponentFixture<TerminalPanel> = TestBed.createComponent(TerminalPanel);
    revived.componentRef.setInput('panel', PANEL);
    revived.detectChanges();
    await revived.whenStable();
    const terminals: Terminal[] = revived.debugElement
      .queryAll(By.directive(Terminal))
      .map((element): Terminal => element.componentInstance as Terminal);
    expect(terminals.map((terminal: Terminal): string => terminal.terminalId())).toEqual([...ids]);
    expect(terminals.every((terminal: Terminal): boolean => terminal.persistent())).toBe(true);
  });
});
