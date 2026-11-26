import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { vi } from 'vitest';
import { Icon } from '@shared/angular/icons/icon';
import { Terminal } from '@shared/angular/components/terminal/terminal';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { DockTabContext } from '@shared/angular/services/dock-layout/dock-tab-context';
import { Settings } from '@shared/angular/services/settings/settings';
import { TerminalBridge } from '@shared/angular/services/terminal-bridge/terminal-bridge';
import {
  TerminalSession,
  TerminalSessions,
} from '@shared/angular/services/terminal-sessions/terminal-sessions';
import { Accent, ResolvedThemeMode, Theme } from '@shared/angular/services/theme/theme';
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
            accent: signal<Accent>({ kind: 'preset', id: 'blue' }),
            accentHex: signal<string>('#0D6EFD'),
            accentRgb: signal<string>('13, 110, 253'),
          },
        },
      ],
    }).compileComponents();

    context = TestBed.inject(DockTabContext);
    fixture = TestBed.createComponent(TerminalPanel);
    fixture.componentRef.setInput('panel', PANEL);
    host = fixture.nativeElement as HTMLElement;
  });

  /**
   * Announces a root the way the owning view does: to the dock context (the panel's template guard)
   * and the session store (the sessions' working directory) together.
   * @param root The root to announce.
   */
  function announceRoot(root: string | null): void {
    context.setRoot(root);
    TestBed.inject(TerminalSessions).setRoot(root);
  }

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
    announceRoot('/repo');
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

  it('status_leadsWithThePath_andTrailsWithTheShell_asATerminalTabDoes', async () => {
    context.setTabId('tab-1');
    announceRoot('/repo');
    fixture.detectChanges();
    await fixture.whenStable();

    const items: string[] = [...host.querySelectorAll<HTMLElement>('.panel-status__item')].map(
      (item: HTMLElement): string => (item.textContent ?? '').trim(),
    );
    expect(items[0]).toBe('/repo');
    expect(host.querySelector('.panel-status__item--push app-icon')).not.toBeNull();
    expect(items[1]).not.toBe('/repo');
  });

  it('newTerminal_mountsAnAdditionalConcurrentTerminalWithADistinctSession', async () => {
    context.setTabId('tab-1');
    announceRoot('/repo');
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
    // Listed in the picker rather than as tabs, which piled up when many were open.
    expect(
      host.querySelectorAll('[data-testid="terminal-picker"] option:not([hidden])'),
    ).toHaveLength(2);
  });

  it('render_whenOutsideElectron_theHostedTerminalShowsItsUnavailableNotice', async () => {
    context.setTabId('tab-1');
    announceRoot('/repo');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host.textContent).toContain('Terminal is only available when running inside Electron.');
  });

  it('root_whenTheFolderCloses_revertsToThePromptAndDisposesTheSessions', async () => {
    context.setTabId('tab-1');
    announceRoot('/repo');
    fixture.detectChanges();
    await fixture.whenStable();
    const sessions: TerminalSessions = TestBed.inject(TerminalSessions);
    const id: string = sessions.sessions()[0].id;

    announceRoot(null);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host.querySelector('app-terminal')).toBeNull();
    expect(host.querySelector('.terminal-panel__empty')).not.toBeNull();
    expect(dispose).toHaveBeenCalledWith(id);
  });

  it('destroy_leavesTheSessionsAliveForTheNextPanelToReAttach', async () => {
    context.setTabId('tab-1');
    announceRoot('/repo');
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

  it('picker_numbersTerminalsThatShareAName_andSwitchesBetweenThem', async () => {
    context.setTabId('tab-1');
    announceRoot('/repo');
    fixture.detectChanges();
    await fixture.whenStable();
    host.querySelector<HTMLButtonElement>('button[aria-label="New Terminal"]')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    const sessions: TerminalSessions = TestBed.inject(TerminalSessions);
    const [first, second] = sessions.sessions();
    sessions.rename(first.id, 'build');
    sessions.rename(second.id, 'build');
    fixture.detectChanges();
    await fixture.whenStable();

    const options: HTMLOptionElement[] = [
      ...host.querySelectorAll<HTMLOptionElement>(
        '[data-testid="terminal-picker"] option:not([hidden])',
      ),
    ];
    expect(
      options.map((option: HTMLOptionElement): string => option.textContent?.trim() ?? ''),
    ).toEqual(['build (1)', 'build (2)']);

    const select: HTMLSelectElement = host.querySelector<HTMLSelectElement>(
      '[data-testid="terminal-picker"] select',
    )!;
    select.value = first.id;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(sessions.activeId()).toBe(first.id);
  });

  it('close_closesTheTerminalShown', async () => {
    context.setTabId('tab-1');
    announceRoot('/repo');
    fixture.detectChanges();
    await fixture.whenStable();
    host.querySelector<HTMLButtonElement>('button[aria-label="New Terminal"]')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    const sessions: TerminalSessions = TestBed.inject(TerminalSessions);
    const shown: string | null = sessions.activeId();
    // Nothing runs in these terminals; the close confirmation is the guard's to test, not this.
    TestBed.inject(Settings).set('terminal.confirmClose', 'never');

    host.querySelector<HTMLButtonElement>('button[aria-label="Close Terminal"]')!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(sessions.sessions().map((session) => session.id)).not.toContain(shown);
    expect(sessions.sessions()).toHaveLength(1);
  });

  it('rename_swapsThePickerForANameField_andCommitsOnEnter', async () => {
    context.setTabId('tab-1');
    announceRoot('/repo');
    fixture.detectChanges();
    await fixture.whenStable();

    host.querySelector<HTMLButtonElement>('button[aria-label="Rename Terminal"]')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    const field: HTMLInputElement | null = host.querySelector('.terminal-panel__rename input');
    expect(host.querySelector('[data-testid="terminal-picker"]')).toBeNull();
    field!.value = 'server';
    field!.dispatchEvent(new Event('input'));
    field!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(TestBed.inject(TerminalSessions).sessions()[0].name).toBe('server');
    expect(host.querySelector('[data-testid="terminal-picker"]')).not.toBeNull();
  });
});
