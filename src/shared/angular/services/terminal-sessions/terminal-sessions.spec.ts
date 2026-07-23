import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { DockReveal } from '@shared/angular/services/dock-layout/dock-reveal';
import { TerminalBridge } from '@shared/angular/services/terminal-bridge/terminal-bridge';
import { TerminalSession, TerminalSessions } from './terminal-sessions';

describe('TerminalSessions', () => {
  let sessions: TerminalSessions;
  let dispose: ReturnType<typeof vi.fn>;
  let reveal: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    dispose = vi.fn((): Promise<boolean> => Promise.resolve(true));
    reveal = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        TerminalSessions,
        { provide: TerminalBridge, useValue: { dispose } },
        { provide: DockReveal, useValue: { reveal } },
      ],
    });
    sessions = TestBed.inject(TerminalSessions);
  });

  it('startsEmpty', () => {
    expect(sessions.sessions()).toEqual([]);
    expect(sessions.activeId()).toBeNull();
  });

  it('create_addsASessionWithADistinctNameAndMakesItActive', () => {
    const first: TerminalSession = sessions.create();
    const second: TerminalSession = sessions.create();

    expect(sessions.sessions().map((s: TerminalSession): string => s.name)).toEqual([
      'Terminal 1',
      'Terminal 2',
    ]);
    expect(first.id).not.toBe(second.id);
    expect(sessions.activeId()).toBe(second.id);
  });

  it('setRoot_whenTheFirstRootArrives_opensOneSessionRootedThere', () => {
    sessions.setRoot('/repo');

    expect(sessions.sessions()).toHaveLength(1);
    expect(sessions.sessions()[0].cwd).toBe('/repo');
    expect(dispose).not.toHaveBeenCalled();
  });

  it('setRoot_whenReAnnouncingTheSameRoot_leavesTheSessionsUntouched', () => {
    sessions.setRoot('/repo');
    const existing: readonly TerminalSession[] = sessions.sessions();

    // The panel re-announces the root every time it re-mounts after a tool-tab switch.
    sessions.setRoot('/repo');

    expect(sessions.sessions()).toEqual(existing);
    expect(dispose).not.toHaveBeenCalled();
  });

  it('setRoot_whenTheRootChanges_disposesTheOldSessionsAndOpensAFreshOne', () => {
    sessions.setRoot('/repo');
    const old: string = sessions.sessions()[0].id;

    sessions.setRoot('/other');

    expect(dispose).toHaveBeenCalledWith(old);
    expect(sessions.sessions()).toHaveLength(1);
    expect(sessions.sessions()[0].cwd).toBe('/other');
    // Naming restarts with the fresh folder.
    expect(sessions.sessions()[0].name).toBe('Terminal 1');
  });

  it('setRoot_whenTheFolderCloses_disposesEverySessionAndOpensNone', () => {
    sessions.setRoot('/repo');
    sessions.create();
    const ids: readonly string[] = sessions.sessions().map((s: TerminalSession): string => s.id);

    sessions.setRoot(null);

    for (const id of ids) {
      expect(dispose).toHaveBeenCalledWith(id);
    }
    expect(sessions.sessions()).toEqual([]);
    expect(sessions.activeId()).toBeNull();
  });

  it('activate_switchesTheActiveSession', () => {
    const first: TerminalSession = sessions.create();
    sessions.create();

    sessions.activate(first.id);
    expect(sessions.activeId()).toBe(first.id);
  });

  it('close_disposesTheSessionAndActivatesTheOneThatTookItsPlace', () => {
    const first: TerminalSession = sessions.create();
    const second: TerminalSession = sessions.create();
    const third: TerminalSession = sessions.create();

    sessions.activate(second.id);
    sessions.close(second.id);

    expect(dispose).toHaveBeenCalledWith(second.id);
    expect(sessions.sessions().map((s: TerminalSession): string => s.id)).toEqual([
      first.id,
      third.id,
    ]);
    // The session that shifted into the closed slot becomes active.
    expect(sessions.activeId()).toBe(third.id);
  });

  it('close_theLastSession_leavesNoneActive', () => {
    const only: TerminalSession = sessions.create();

    sessions.close(only.id);

    expect(sessions.sessions()).toEqual([]);
    expect(sessions.activeId()).toBeNull();
  });

  it('close_anUnknownSession_isIgnored', () => {
    sessions.create();

    sessions.close('missing');

    expect(dispose).not.toHaveBeenCalledWith('missing');
    expect(sessions.sessions()).toHaveLength(1);
  });

  it('rename_updatesTheDisplayName_ignoringBlankNames', () => {
    const session: TerminalSession = sessions.create();

    sessions.rename(session.id, '  build  ');
    expect(sessions.sessions()[0].name).toBe('build');

    sessions.rename(session.id, '   ');
    expect(sessions.sessions()[0].name).toBe('build');
  });

  it('setShell_recordsTheSpawnedShell', () => {
    const session: TerminalSession = sessions.create();

    sessions.setShell(session.id, '/bin/zsh');

    expect(sessions.sessions()[0].shell).toBe('/bin/zsh');
    expect(sessions.activeSession()?.shell).toBe('/bin/zsh');
  });

  it('activateAndReveal_activatesTheSessionAndRevealsTheTerminalPanel', () => {
    const first: TerminalSession = sessions.create();
    sessions.create();

    sessions.activateAndReveal(first.id);

    expect(sessions.activeId()).toBe(first.id);
    expect(reveal).toHaveBeenCalledWith('terminal');
  });

  it('activateAndReveal_whenTheSessionIsUnknown_isIgnored', () => {
    const only: TerminalSession = sessions.create();

    sessions.activateAndReveal('missing');

    expect(sessions.activeId()).toBe(only.id);
    expect(reveal).not.toHaveBeenCalled();
  });

  it('ngOnDestroy_disposesEverySession', () => {
    sessions.setRoot('/repo');
    sessions.create();
    const ids: readonly string[] = sessions.sessions().map((s: TerminalSession): string => s.id);

    sessions.ngOnDestroy();

    for (const id of ids) {
      expect(dispose).toHaveBeenCalledWith(id);
    }
    expect(sessions.sessions()).toEqual([]);
  });
});
