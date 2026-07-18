import { TestBed } from '@angular/core/testing';
import { TerminalSession, TerminalSessions } from './terminal-sessions';

describe('TerminalSessions', () => {
  let sessions: TerminalSessions;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [TerminalSessions] });
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

  it('ensureOne_createsATerminalOnlyWhenEmpty', () => {
    sessions.ensureOne();
    expect(sessions.sessions()).toHaveLength(1);
    sessions.ensureOne();
    expect(sessions.sessions()).toHaveLength(1);
  });

  it('activate_switchesTheActiveSession', () => {
    const first: TerminalSession = sessions.create();
    sessions.create();

    sessions.activate(first.id);
    expect(sessions.activeId()).toBe(first.id);
  });

  it('close_removesTheSessionAndActivatesTheOneThatTookItsPlace', () => {
    const first: TerminalSession = sessions.create();
    const second: TerminalSession = sessions.create();
    const third: TerminalSession = sessions.create();

    sessions.activate(second.id);
    sessions.close(second.id);

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

  it('close_anInactiveSession_keepsTheActiveOne', () => {
    const first: TerminalSession = sessions.create();
    const second: TerminalSession = sessions.create();

    sessions.close(first.id);
    expect(sessions.activeId()).toBe(second.id);
  });

  it('rename_changesTheNameButIgnoresBlank', () => {
    const session: TerminalSession = sessions.create();

    sessions.rename(session.id, '  build shell  ');
    expect(sessions.sessions()[0].name).toBe('build shell');

    sessions.rename(session.id, '   ');
    expect(sessions.sessions()[0].name).toBe('build shell');
  });
});
