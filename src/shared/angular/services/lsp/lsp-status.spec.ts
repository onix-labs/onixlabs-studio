import { TestBed } from '@angular/core/testing';
import { afterEach, vi } from 'vitest';
import { LspServer, LspStatus } from './lsp-status';

/**
 * The readiness-watchdog window (mirrors READINESS_WATCHDOG_MS in lsp-status.ts). A server left in its
 * starting state for this long is marked unavailable.
 */
const WATCHDOG_MS: number = 120_000;

describe('LspStatus', () => {
  let status: LspStatus;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({});
    status = TestBed.inject(LspStatus);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Registers a server with a no-op restart callback unless one is supplied.
   * @param sessionId The session id.
   * @param serverId The server id.
   * @param rootPath The session root.
   * @param restart The restart callback.
   */
  function register(
    sessionId: string,
    serverId: string,
    rootPath: string,
    restart: () => void = (): void => undefined,
  ): void {
    status.register(sessionId, { serverId, rootPath, restart });
  }

  it('servers_whenNoneRegistered_isEmpty', () => {
    expect(status.servers()).toEqual([]);
  });

  it('register_addsServerInStartingState', () => {
    register('/root::java', 'java', '/root');

    const servers: readonly LspServer[] = status.servers();
    expect(servers.length).toBe(1);
    expect(servers[0]).toEqual(
      expect.objectContaining({
        sessionId: '/root::java',
        serverId: 'java',
        name: 'Java',
        rootPath: '/root',
        state: 'starting',
      }),
    );
  });

  it('setState_updatesTrackedServerState', () => {
    register('/root::typescript', 'typescript', '/root');
    status.setState('/root::typescript', 'ready');

    expect(status.servers()[0].state).toBe('ready');
  });

  it('setState_carriesTheDetailForUnavailable', () => {
    register('/root::java', 'java', '/root');
    status.setState('/root::java', 'unavailable', 'Java 21+ runtime not found');

    const server: LspServer = status.servers()[0];
    expect(server.state).toBe('unavailable');
    expect(server.detail).toBe('Java 21+ runtime not found');
  });

  it('setState_whenSessionUnknown_isIgnored', () => {
    status.setState('/root::java', 'ready');

    expect(status.servers()).toEqual([]);
  });

  it('servers_areSortedByName', () => {
    register('/root::typescript', 'typescript', '/root');
    register('/root::clangd', 'clangd', '/root');

    expect(status.servers().map((server: LspServer): string => server.name)).toEqual([
      'C/C++',
      'TypeScript',
    ]);
  });

  it('restart_invokesTheRegisteredCallback', () => {
    let calls: number = 0;
    register('/root::java', 'java', '/root', (): void => {
      calls += 1;
    });

    status.restart('/root::java');

    expect(calls).toBe(1);
  });

  it('register_keepsTheServerWhenReRegisteredAfterRestart', () => {
    register('/root::java', 'java', '/root');
    status.setState('/root::java', 'ready');
    register('/root::java', 'java', '/root');

    const servers: readonly LspServer[] = status.servers();
    expect(servers.length).toBe(1);
    expect(servers[0].state).toBe('starting');
  });

  it('remove_stopsTrackingTheServer', () => {
    register('/root::java', 'java', '/root');
    status.remove('/root::java');

    expect(status.servers()).toEqual([]);
  });

  it('watchdog_whenStartingTooLong_marksServerUnavailable', () => {
    register('/root::java', 'java', '/root');

    vi.advanceTimersByTime(WATCHDOG_MS);

    const server: LspServer = status.servers()[0];
    expect(server.state).toBe('unavailable');
    expect(server.detail).toContain('Restart it');
  });

  it('watchdog_whenServerBecomesReadyFirst_leavesItReady', () => {
    register('/root::typescript', 'typescript', '/root');
    status.setState('/root::typescript', 'ready');

    vi.advanceTimersByTime(WATCHDOG_MS);

    expect(status.servers()[0].state).toBe('ready');
  });

  it('watchdog_whenServerRemovedFirst_doesNotResurrectIt', () => {
    register('/root::java', 'java', '/root');
    status.remove('/root::java');

    vi.advanceTimersByTime(WATCHDOG_MS);

    expect(status.servers()).toEqual([]);
  });

  it('watchdog_isReArmedByARestartBackToStarting', () => {
    register('/root::java', 'java', '/root');
    status.setState('/root::java', 'ready');
    // A restart drops the server back to starting; the watchdog must re-arm from that moment.
    status.setState('/root::java', 'starting');

    vi.advanceTimersByTime(WATCHDOG_MS);

    expect(status.servers()[0].state).toBe('unavailable');
  });
});
