import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { DockReveal } from '@shared/angular/services/dock-layout/dock-reveal';
import { PopoutPanels } from '@shared/angular/services/dock-layout/popout-panels';
import { TerminalBridge } from '@shared/angular/services/terminal-bridge/terminal-bridge';
import { TerminalLaunch, TerminalSession, TerminalSessions } from './terminal-sessions';

describe('TerminalSessions', () => {
  let sessions: TerminalSessions;
  let dispose: ReturnType<typeof vi.fn>;
  let create: ReturnType<typeof vi.fn>;
  let terminate: ReturnType<typeof vi.fn>;
  let reveal: ReturnType<typeof vi.fn>;
  let fireExit: (id: string, exitCode: number, signal?: number | null) => void;

  beforeEach(() => {
    dispose = vi.fn((): Promise<boolean> => Promise.resolve(true));
    create = vi.fn((): Promise<{ success: boolean }> => Promise.resolve({ success: true }));
    terminate = vi.fn((): Promise<boolean> => Promise.resolve(true));
    reveal = vi.fn();
    let exitListener: (id: string, exitCode: number, signal: number | null) => void = () =>
      undefined;
    fireExit = (id: string, exitCode: number, signal: number | null = null): void =>
      exitListener(id, exitCode, signal);
    TestBed.configureTestingModule({
      providers: [
        TerminalSessions,
        {
          provide: TerminalBridge,
          useValue: {
            dispose,
            create,
            terminate,
            onExit: (
              listener: (id: string, exitCode: number, signal: number | null) => void,
            ): (() => void) => {
              exitListener = listener;
              return (): void => undefined;
            },
          },
        },
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

  it('setRoot_opensNothingItself_andEnsureShellOpensTheFirstShell', () => {
    sessions.setRoot('/repo');
    expect(sessions.sessions()).toHaveLength(0);

    sessions.ensureShell();

    expect(sessions.sessions()).toHaveLength(1);
    expect(sessions.sessions()[0].kind).toBe('shell');
    expect(sessions.sessions()[0].cwd).toBe('/repo');
    expect(dispose).not.toHaveBeenCalled();
  });

  it('ensureShell_beforeARootIsKnown_isANoOp', () => {
    sessions.ensureShell();

    expect(sessions.sessions()).toHaveLength(0);
  });

  it('ensureShell_whenAShellExists_addsNothing', () => {
    sessions.setRoot('/repo');
    sessions.ensureShell();
    sessions.ensureShell();

    expect(sessions.sessions()).toHaveLength(1);
  });

  it('ensureShell_doesNotStealActivationFromALaunchedSession', async () => {
    sessions.setRoot('/repo');
    const { session } = await sessions.launch({ name: 'Build', kind: 'task', command: 'make' });

    // The panel mounts because the launch revealed it, then asks for its shell.
    sessions.ensureShell();

    expect(sessions.sessions()).toHaveLength(2);
    expect(sessions.activeId()).toBe(session.id);
  });

  it('setRoot_theFirstRoot_keepsSessionsLaunchedBeforeIt', async () => {
    const { session } = await sessions.launch({ name: 'Build', kind: 'task', command: 'make', cwd: '/w' });

    sessions.setRoot('/repo');

    expect(sessions.sessions().map((s: TerminalSession): string => s.id)).toEqual([session.id]);
    expect(dispose).not.toHaveBeenCalled();
  });

  it('setRoot_whenReAnnouncingTheSameRoot_leavesTheSessionsUntouched', () => {
    sessions.setRoot('/repo');
    sessions.ensureShell();
    const existing: readonly TerminalSession[] = sessions.sessions();

    sessions.setRoot('/repo');

    expect(sessions.sessions()).toEqual(existing);
    expect(dispose).not.toHaveBeenCalled();
  });

  it('setRoot_whenTheRootChanges_disposesTheOldSessions', () => {
    sessions.setRoot('/repo');
    sessions.ensureShell();
    const old: string = sessions.sessions()[0].id;

    sessions.setRoot('/other');

    expect(dispose).toHaveBeenCalledWith(old);
    expect(sessions.sessions()).toHaveLength(0);

    // The panel's next ensureShell opens the new folder's shell, with naming restarted.
    sessions.ensureShell();
    expect(sessions.sessions()[0].cwd).toBe('/other');
    expect(sessions.sessions()[0].name).toBe('Terminal 1');
  });

  it('setRoot_whenTheFolderCloses_disposesEverySession', () => {
    sessions.setRoot('/repo');
    sessions.ensureShell();
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

  it('launch_opensACommandSessionSpawnsItAndRevealsIt', async () => {
    const { session } = await sessions.launch({
      name: 'Build',
      kind: 'task',
      command: 'dotnet build',
      cwd: '/repo',
    });

    expect(session.kind).toBe('task');
    expect(session.name).toBe('Build');
    expect(session.generation).toBe(0);
    expect(session.exitCode).toBeNull();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ id: session.id, kind: 'task', command: 'dotnet build', cwd: '/repo' }),
    );
    expect(sessions.activeId()).toBe(session.id);
    expect(reveal).toHaveBeenCalledWith('terminal');
  });

  it('launch_withWindowPresentation_popsThePanelOutInsteadOfRevealingTheDock', async () => {
    const popouts: PopoutPanels = TestBed.inject(PopoutPanels);
    let popped: number = 0;
    popouts.registerPopOut('terminal', (): void => {
      popped++;
    });

    const { session } = await sessions.launch({
      name: 'Run: Api',
      kind: 'run',
      command: 'node api.js',
      presentation: 'window',
    });

    expect(sessions.activeId()).toBe(session.id);
    expect(popped).toBe(1);
    expect(reveal).not.toHaveBeenCalled();
  });

  it('launch_withWindowPresentation_butNoPopOutSupport_fallsBackToTheDockReveal', async () => {
    const { session } = await sessions.launch({
      name: 'Run: Api',
      kind: 'run',
      command: 'node api.js',
      presentation: 'window',
    });

    expect(sessions.activeId()).toBe(session.id);
    expect(reveal).toHaveBeenCalledWith('terminal');
  });

  it('launch_exit_resolvesTheCompletionAndRecordsTheExitCode', async () => {
    const { session, exited } = await sessions.launch({
      name: 'Run: Api',
      kind: 'run',
      command: 'dotnet run',
    });

    fireExit(session.id, 0);

    await expect(exited).resolves.toBe(0);
    expect(sessions.sessions()[0].exitCode).toBe(0);
  });

  it('launch_withAReusedSessionId_relaunchesInPlace', async () => {
    const first: TerminalLaunch = await sessions.launch({
      sessionId: 'build-console',
      name: 'Build',
      kind: 'task',
      command: 'make',
    });

    const second: TerminalLaunch = await sessions.launch({
      sessionId: 'build-console',
      name: 'Build',
      kind: 'task',
      command: 'make clean && make',
    });

    // The previous run's completion resolves as disposed, the PTY is disposed for a fresh spawn,
    // and the same tab (one session) carries a bumped generation with a reset exit.
    await expect(first.exited).resolves.toBe(-1);
    expect(dispose).toHaveBeenCalledWith('build-console');
    expect(sessions.sessions()).toHaveLength(1);
    expect(second.session.generation).toBe(1);
    expect(second.session.exitCode).toBeNull();
    expect(create).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'build-console', command: 'make clean && make' }),
    );
  });

  it('launch_whenTheSpawnFails_resolvesTheCompletionWithAFailure', async () => {
    create.mockResolvedValueOnce({ success: false, error: 'nope' });

    const { session, exited } = await sessions.launch({
      name: 'Run',
      kind: 'run',
      command: 'missing-binary',
    });

    await expect(exited).resolves.toBe(1);
    expect(sessions.sessions().find((s: TerminalSession): boolean => s.id === session.id)?.exitCode).toBe(1);
  });

  it('close_ofARunningLaunchedSession_resolvesItsCompletionAsDisposed', async () => {
    const { session, exited } = await sessions.launch({
      name: 'Run',
      kind: 'run',
      command: 'sleep 100',
    });

    sessions.close(session.id);

    await expect(exited).resolves.toBe(-1);
    expect(dispose).toHaveBeenCalledWith(session.id);
  });

  it('waitForExit_afterTheExit_resolvesImmediately', async () => {
    const { session } = await sessions.launch({ name: 'Run', kind: 'run', command: 'true' });
    fireExit(session.id, 3);

    await expect(sessions.waitForExit(session.id)).resolves.toBe(3);
  });

  it('exit_byASignal_recordsTheShellConventionCodeSoAStopNeverReadsAsSuccess', async () => {
    const { session, exited } = await sessions.launch({
      name: 'Run',
      kind: 'run',
      command: 'sleep 100',
    });

    // node-pty reports a SIGTERM'd process as exit code 0 with signal 15.
    fireExit(session.id, 0, 15);

    await expect(exited).resolves.toBe(143);
    expect(sessions.sessions()[0].exitCode).toBe(143);
  });

  it('exitEvents_updateShellSessionsToo', () => {
    const session: TerminalSession = sessions.create();

    fireExit(session.id, 130);

    expect(sessions.sessions()[0].exitCode).toBe(130);
  });

  it('terminate_signalsTheSessionWithoutRemovingIt', async () => {
    const { session } = await sessions.launch({ name: 'Run', kind: 'run', command: 'sleep 100' });

    sessions.terminate(session.id);

    expect(terminate).toHaveBeenCalledWith(session.id);
    expect(sessions.sessions()).toHaveLength(1);
  });

  it('ngOnDestroy_disposesEverySession', () => {
    sessions.setRoot('/repo');
    sessions.ensureShell();
    sessions.create();
    const ids: readonly string[] = sessions.sessions().map((s: TerminalSession): string => s.id);

    sessions.ngOnDestroy();

    for (const id of ids) {
      expect(dispose).toHaveBeenCalledWith(id);
    }
    expect(sessions.sessions()).toEqual([]);
  });
});
