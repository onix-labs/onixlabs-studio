import { TestBed } from '@angular/core/testing';
import { LspServer, LspStatus } from './lsp-status';

describe('LspStatus', () => {
  let status: LspStatus;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    status = TestBed.inject(LspStatus);
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
});
