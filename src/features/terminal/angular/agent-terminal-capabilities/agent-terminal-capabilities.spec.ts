import { TestBed } from '@angular/core/testing';

import {
  type AiBridgeScope,
  READ_TERMINAL_OUTPUT,
  UNSCOPED_BRIDGE_REQUEST,
  WRITE_TERMINAL_INPUT,
} from '@shared/api/ai-types';
import { TerminalReplay } from '@shared/api/terminal-channels';
import { AiCapability, AiRuntime } from '@shared/angular/services/ai-runtime/ai-runtime';
import { TerminalBridge } from '@shared/angular/services/terminal-bridge/terminal-bridge';
import { Terminals } from '@shared/angular/services/terminals/terminals';
import {
  ActiveWorkspace,
  WellTerminal,
  WorkspaceWellHandlers,
} from '@shared/angular/services/workspace/active-workspace';
import { AgentTerminalCapabilities } from './agent-terminal-capabilities';

/**
 * Publishes a workspace well whose dock holds the given terminals.
 * @param scope The well's scope (its key, and the owner its agent runs with).
 * @param root The workspace root.
 * @param terminalIds The ids of the terminals in its dock.
 */
function publishWell(scope: string, root: string, terminalIds: readonly string[]): void {
  const handlers: Partial<WorkspaceWellHandlers> = {
    rootPath: (): string => root,
    terminals: (): readonly WellTerminal[] =>
      terminalIds.map((id: string): WellTerminal => ({ id, name: id, active: false })),
  };
  TestBed.inject(ActiveWorkspace).setWell(scope, scope, handlers as WorkspaceWellHandlers);
}

/**
 * Builds the scope of a run docked in a workspace.
 * @param owner The workspace view's scope.
 * @returns Returns the scope.
 */
function workspaceRun(owner: string): AiBridgeScope {
  return { owningTabId: owner, surface: 'workspace', workspaceRoot: null };
}

/**
 * The result of the read-terminal-output capability, as the registered handler returns it.
 */
interface ReadResult {
  readonly available: boolean;
  readonly text: string;
}

/**
 * The result of the write-terminal-input capability, as the registered handler returns it.
 */
interface WriteResult {
  readonly ok: boolean;
  readonly output?: string;
}

describe('AgentTerminalCapabilities', () => {
  let registered: Map<string, AiCapability>;
  let terminals: Terminals;
  let writes: { id: string; data: string }[];
  let replays: Map<string, TerminalReplay>;

  beforeEach(() => {
    registered = new Map<string, AiCapability>();
    writes = [];
    replays = new Map<string, TerminalReplay>();
    const runtimeStub: Pick<AiRuntime, 'registerCapability'> = {
      registerCapability: (name: string, handler: AiCapability): (() => void) => {
        registered.set(name, handler);
        return (): void => undefined;
      },
    };
    const bridgeStub: Pick<TerminalBridge, 'write' | 'replay'> = {
      write: (id: string, data: string): Promise<boolean> => {
        writes.push({ id, data });
        return Promise.resolve(true);
      },
      replay: (id: string): Promise<TerminalReplay> =>
        Promise.resolve(replays.get(id) ?? { data: '', seq: 0, exitCode: null, signal: null }),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: AiRuntime, useValue: runtimeStub },
        { provide: TerminalBridge, useValue: bridgeStub },
      ],
    });
    terminals = TestBed.inject(Terminals);
    // Instantiate the service so it registers its capabilities.
    TestBed.inject(AgentTerminalCapabilities);
  });

  it('constructor_whenInstantiated_registersReadAndWriteCapabilities', () => {
    expect(registered.has(READ_TERMINAL_OUTPUT)).toBe(true);
    expect(registered.has(WRITE_TERMINAL_INPUT)).toBe(true);
  });

  it('read_whenNoTerminalRegistered_reportsUnavailable', async () => {
    const read: AiCapability | undefined = registered.get(READ_TERMINAL_OUTPUT);

    expect(await read?.({ tabId: 'term-1' }, UNSCOPED_BRIDGE_REQUEST)).toEqual({
      available: false,
      text: '',
    });
  });

  it('read_whenTerminalRegistered_returnsItsOutput', async () => {
    terminals.register('term-1', { readText: (): string => 'line one\nline two' });
    const read: AiCapability | undefined = registered.get(READ_TERMINAL_OUTPUT);

    expect(await read?.({ tabId: 'term-1' }, UNSCOPED_BRIDGE_REQUEST)).toEqual({
      available: true,
      text: 'line one\nline two',
    });
  });

  it('read_whenTabIdGiven_readsThatTerminalNotAnother', async () => {
    terminals.register('term-1', { readText: (): string => 'one' });
    terminals.register('term-2', { readText: (): string => 'two' });
    const read: AiCapability | undefined = registered.get(READ_TERMINAL_OUTPUT);

    expect(((await read?.({ tabId: 'term-1' }, UNSCOPED_BRIDGE_REQUEST)) as ReadResult).text).toBe(
      'one',
    );
  });

  it('read_whenNoPaneIsMountedHere_fallsBackToTheScrollbackReplay', async () => {
    // The session's pane lives in another window (a popped-out panel): no local read handle, but
    // the main-process scrollback still answers — control sequences stripped.
    const esc: string = String.fromCharCode(27);
    const bel: string = String.fromCharCode(7);
    replays.set('term-9', {
      data: `${esc}]0;title${bel}$ echo hi\r\n${esc}[32mhi${esc}[0m\r\n`,
      seq: 3,
      exitCode: null,
      signal: null,
    });
    const read: AiCapability | undefined = registered.get(READ_TERMINAL_OUTPUT);

    expect(await read?.({ tabId: 'term-9' }, UNSCOPED_BRIDGE_REQUEST)).toEqual({
      available: true,
      text: '$ echo hi\nhi\n',
    });
  });

  it('write_whenSubmitted_writesTextWithCarriageReturnAndReturnsOutput', async () => {
    terminals.register('term-1', { readText: (): string => 'result' });
    const write: AiCapability | undefined = registered.get(WRITE_TERMINAL_INPUT);

    const result: WriteResult = (await write?.(
      { tabId: 'term-1', text: 'ls' },
      UNSCOPED_BRIDGE_REQUEST,
    )) as WriteResult;

    expect(writes).toEqual([{ id: 'term-1', data: 'ls\r' }]);
    expect(result).toEqual({ ok: true, output: 'result' });
  });

  it('write_whenSubmitFalse_writesRawTextWithoutCarriageReturn', async () => {
    terminals.register('term-1', { readText: (): string => 'result' });
    const write: AiCapability | undefined = registered.get(WRITE_TERMINAL_INPUT);

    await write?.({ tabId: 'term-1', text: 'ls', submit: false }, UNSCOPED_BRIDGE_REQUEST);

    expect(writes).toEqual([{ id: 'term-1', data: 'ls' }]);
  });

  it('write_whenInputMalformed_reportsNotOk', async () => {
    const write: AiCapability | undefined = registered.get(WRITE_TERMINAL_INPUT);

    const result: WriteResult = (await write?.(
      { tabId: 'term-1' },
      UNSCOPED_BRIDGE_REQUEST,
    )) as WriteResult;

    expect(result).toEqual({ ok: false });
    expect(writes).toHaveLength(0);
  });

  it('read_whenTheTerminalBelongsToAnotherWorkspace_refusesIt', async () => {
    publishWell('ws-a', '/a', ['term-a']);
    publishWell('ws-b', '/b', ['term-b']);
    terminals.register('term-a', { readText: (): string => 'secret from A' });
    const read: AiCapability | undefined = registered.get(READ_TERMINAL_OUTPUT);

    const result: ReadResult = (await read?.(
      { tabId: 'term-a' },
      workspaceRun('ws-b'),
    )) as ReadResult;

    expect(result.available).toBe(false);
    expect(result.text).toBe('');
  });

  it('read_whenTheTerminalBelongsToTheRunsOwnWorkspace_readsIt', async () => {
    publishWell('ws-a', '/a', ['term-a']);
    terminals.register('term-a', { readText: (): string => 'mine' });
    const read: AiCapability | undefined = registered.get(READ_TERMINAL_OUTPUT);

    const result: ReadResult = (await read?.(
      { tabId: 'term-a' },
      workspaceRun('ws-a'),
    )) as ReadResult;

    expect(result).toEqual({ available: true, text: 'mine' });
  });

  it('write_whenTheTerminalBelongsToAnotherWorkspace_refusesWithoutTyping', async () => {
    publishWell('ws-a', '/a', ['term-a']);
    publishWell('ws-b', '/b', ['term-b']);
    terminals.register('term-a', { readText: (): string => '' });
    const write: AiCapability | undefined = registered.get(WRITE_TERMINAL_INPUT);

    const result: WriteResult = (await write?.(
      { tabId: 'term-a', text: 'rm -rf build' },
      workspaceRun('ws-b'),
    )) as WriteResult;

    expect(result.ok).toBe(false);
    expect(writes).toHaveLength(0);
  });

  it('read_whenAWorkspaceRunNamesATopLevelTerminal_refusesIt', async () => {
    publishWell('ws-a', '/a', ['term-a']);
    terminals.register('tab-terminal', { readText: (): string => 'outside' });
    const read: AiCapability | undefined = registered.get(READ_TERMINAL_OUTPUT);

    const result: ReadResult = (await read?.(
      { tabId: 'tab-terminal' },
      workspaceRun('ws-a'),
    )) as ReadResult;

    expect(result.available).toBe(false);
  });
});
