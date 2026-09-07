import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import type {
  AgentContextRef,
  AgentMode,
  AiModelInfo,
  AiRemoteControlMode,
} from '@shared/api/ai-types';
import { AgentSessionHandle, AgentSessions } from './agent-sessions';

/**
 * A fake session handle whose signals the tests drive and whose commands record their invocations.
 */
interface FakeSession {
  /**
   * Gets the handle registered with the service.
   */
  readonly handle: AgentSessionHandle;

  /**
   * Gets the writable run-state signal backing the handle.
   */
  readonly running: WritableSignal<boolean>;

  /**
   * Gets the writable mode signal backing the handle.
   */
  readonly modeState: WritableSignal<AgentMode>;

  /**
   * Gets the recorded command invocations, in order.
   */
  readonly calls: string[];
}

/**
 * Creates a fake session handle whose signals are writable and whose commands record themselves.
 * @returns Returns the fake session.
 */
function createSession(): FakeSession {
  const running: WritableSignal<boolean> = signal<boolean>(false);
  const modeState: WritableSignal<AgentMode> = signal<AgentMode>('chat');
  const contextPaths: WritableSignal<readonly AgentContextRef[]> = signal<
    readonly AgentContextRef[]
  >([{ path: '/ws/readme.md', kind: 'file' }]);
  const calls: string[] = [];
  const handle: AgentSessionHandle = {
    isRunning: running.asReadonly(),
    mode: modeState.asReadonly(),
    contextPaths: contextPaths.asReadonly(),
    hasMessages: signal<boolean>(true).asReadonly(),
    historyOpen: signal<boolean>(true).asReadonly(),
    provider: signal<string>('claude').asReadonly(),
    model: signal<string>('claude-opus-4-8').asReadonly(),
    models: signal<readonly AiModelInfo[]>([]).asReadonly(),
    supportsRemoteControl: signal<boolean>(true).asReadonly(),
    remoteControl: signal<AiRemoteControlMode>('off').asReadonly(),
    remoteControlEnabled: signal<boolean>(false).asReadonly(),
    setProvider: (id: string): void => {
      calls.push(`setProvider:${id}`);
    },
    setModel: (id: string): void => {
      calls.push(`setModel:${id}`);
    },
    setRemoteControlEnabled: (enabled: boolean): void => {
      calls.push(`setRemoteControlEnabled:${enabled}`);
    },
    newChat: (): void => {
      calls.push('newChat');
    },
    stop: (): void => {
      calls.push('stop');
    },
    toggleHistory: (): void => {
      calls.push('toggleHistory');
    },
    scrollToTop: (): void => void calls.push('scrollToTop'),
    scrollToLastPrompt: (): void => void calls.push('scrollToLastPrompt'),
    scrollToBottom: (): void => {
      calls.push('scrollToBottom');
    },
    setMode: (mode: AgentMode): void => {
      calls.push(`setMode:${mode}`);
    },
    attachFile: (): void => {
      calls.push('attachFile');
    },
    attachFolder: (): void => {
      calls.push('attachFolder');
    },
    attachSelection: (): void => {
      calls.push('attachSelection');
    },
    removeContext: (path: string): void => {
      calls.push(`removeContext:${path}`);
    },
    clearContext: (): void => {
      calls.push('clearContext');
    },
    compact: (): void => {
      calls.push('compact');
    },
  };
  return { handle, running, modeState, calls };
}

describe('AgentSessions', () => {
  let service: AgentSessions;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(AgentSessions);
  });

  it('signals_whenNoSessionIsActive_reportTheDefaults', () => {
    expect(service.isRunning()).toBe(false);
    expect(service.historyOpen()).toBe(false);
    expect(service.mode()).toBe('agent');
    expect(service.contextPaths()).toEqual([]);
  });

  it('setActive_whenASessionRegisters_mirrorsItsSignals', () => {
    const session: FakeSession = createSession();
    service.setActive(session.handle);

    expect(service.isRunning()).toBe(false);
    expect(service.historyOpen()).toBe(true);
    expect(service.mode()).toBe('chat');
    expect(service.contextPaths()).toEqual([{ path: '/ws/readme.md', kind: 'file' }]);

    session.running.set(true);
    expect(service.isRunning()).toBe(true);
  });

  it('commands_whenASessionIsActive_delegateToIt', () => {
    const session: FakeSession = createSession();
    service.setActive(session.handle);

    service.newChat();
    service.stop();
    service.toggleHistory();
    service.scrollToBottom();
    service.setMode('agent');
    service.attachFile();
    service.attachFolder();
    service.removeContext('/ws/readme.md');
    service.compact();

    expect(session.calls).toEqual([
      'newChat',
      'stop',
      'toggleHistory',
      'scrollToBottom',
      'setMode:agent',
      'attachFile',
      'attachFolder',
      'removeContext:/ws/readme.md',
      'compact',
    ]);
  });

  it('commands_whenNoSessionIsActive_areSilentNoOps', () => {
    expect((): void => {
      service.newChat();
      service.stop();
      service.setMode('chat');
      service.compact();
    }).not.toThrow();
  });

  it('clearActive_whenGivenTheActiveSession_dropsIt', () => {
    const session: FakeSession = createSession();
    service.setActive(session.handle);

    service.clearActive(session.handle);

    expect(service.mode()).toBe('agent');
    service.stop();
    expect(session.calls).toEqual([]);
  });

  it('clearActive_whenANewerSessionRegistered_leavesItIntact', () => {
    const older: FakeSession = createSession();
    const newer: FakeSession = createSession();
    service.setActive(older.handle);
    service.setActive(newer.handle);

    service.clearActive(older.handle);

    service.stop();
    expect(newer.calls).toEqual(['stop']);
    expect(older.calls).toEqual([]);
  });
});
