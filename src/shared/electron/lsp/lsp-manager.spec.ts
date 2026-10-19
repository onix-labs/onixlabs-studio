import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, WebContents } from 'electron';
import type { ClientCapabilities } from 'vscode-languageserver-protocol';

vi.mock('electron', () => ({
  ipcMain: { handle: (): void => undefined, on: (): void => undefined },
}));

const { LspManager } = await import('./lsp-manager');
const { clientCapabilities } = await import('./lsp-client-capabilities');
const { LspApplyEditForwarder } = await import('./lsp-apply-edit');
const { WorkspaceContext } = await import('../workspace-context');
type ApplyEditResult = import('./lsp-apply-edit').ApplyEditResult;
type LspServerRegistry = import('./lsp-server-registry').LspServerRegistry;

/**
 * The part of the manager the specs reach past its privacy for: answering a server's requests.
 */
interface ManagerInternals {
  answerServerRequests(connection: unknown, sessionId: string, session: unknown): void;
}

/**
 * A fake server connection recording the request handlers registered on it.
 */
interface FakeConnection {
  readonly handlers: Map<string, (params: unknown) => unknown>;
  fallback: (() => unknown) | null;
  onRequest(method: string | (() => unknown), handler?: (params: unknown) => unknown): void;
}

/**
 * Builds a fake server connection.
 * @returns Returns it.
 */
function fakeConnection(): FakeConnection {
  const connection: FakeConnection = {
    handlers: new Map<string, (params: unknown) => unknown>(),
    fallback: null,
    onRequest(method: string | (() => unknown), handler?: (params: unknown) => unknown): void {
      if (typeof method === 'string' && handler !== undefined) {
        connection.handlers.set(method, handler);
      } else if (typeof method === 'function') {
        connection.fallback = method;
      }
    },
  };
  return connection;
}

/**
 * Builds a fake renderer.
 * @param destroyed Whether it has been destroyed.
 * @returns Returns it.
 */
function contents(destroyed: boolean = false): WebContents {
  return { isDestroyed: (): boolean => destroyed } as unknown as WebContents;
}

describe('LspManager (#1015)', () => {
  it('advertisesRenameWithPrepare_versionedWorkspaceEdits_andApplyEdit_butNoFileOperations', () => {
    const capabilities: ClientCapabilities = clientCapabilities();

    expect(capabilities.textDocument?.rename).toEqual({ prepareSupport: true });
    expect(capabilities.workspace?.applyEdit).toBe(true);
    expect(capabilities.workspace?.workspaceEdit).toEqual({
      documentChanges: true,
      resourceOperations: [],
    });
  });

  it('advertisesCodeActionLiterals_resolveAndData_andExecuteCommand (#1016)', () => {
    const capabilities: ClientCapabilities = clientCapabilities();

    expect(capabilities.textDocument?.codeAction).toEqual({
      dynamicRegistration: false,
      codeActionLiteralSupport: {
        codeActionKind: {
          valueSet: [
            '',
            'quickfix',
            'refactor',
            'refactor.extract',
            'refactor.inline',
            'refactor.rewrite',
            'source',
            'source.organizeImports',
            'source.fixAll',
          ],
        },
      },
      isPreferredSupport: true,
      disabledSupport: true,
      dataSupport: true,
      resolveSupport: { properties: ['edit', 'command'] },
      honorsChangeAnnotations: false,
    });
    expect(capabilities.workspace?.executeCommand).toEqual({ dynamicRegistration: false });
  });

  it('forwardsAServersApplyEditToTheFirstLiveRendererHoldingTheSession_andAnswersWithItsResult', async () => {
    const forwarder: InstanceType<typeof LspApplyEditForwarder> = new LspApplyEditForwarder();
    const forwarded: { sessionId: string; target: WebContents | null; params: unknown }[] = [];
    vi.spyOn(forwarder, 'forward').mockImplementation(
      (
        sessionId: string,
        target: WebContents | null,
        params: unknown,
      ): Promise<ApplyEditResult> => {
        forwarded.push({ sessionId, target, params });
        return Promise.resolve({ applied: true });
      },
    );
    const manager: InstanceType<typeof LspManager> = new LspManager(
      (): BrowserWindow | null => null,
      new WorkspaceContext(),
      {} as LspServerRegistry,
      forwarder,
    );
    const gone: WebContents = contents(true);
    const live: WebContents = contents();
    const session: unknown = {
      clients: new Map<WebContents, number>([
        [gone, 1],
        [live, 1],
      ]),
      watcher: { setPatterns: (): void => undefined },
    };
    const connection: FakeConnection = fakeConnection();
    (manager as unknown as ManagerInternals).answerServerRequests(connection, 's1', session);
    const params: unknown = { edit: { changes: {} } };

    const answer: unknown = await connection.handlers.get('workspace/applyEdit')?.(params);

    expect(answer).toEqual({ applied: true });
    expect(forwarded).toEqual([{ sessionId: 's1', target: live, params }]);
    // Every other server request is still acknowledged with null.
    expect(connection.fallback?.()).toBeNull();
  });

  it('forwardsToTheMainWindow_whenNoRendererHoldsTheSession', async () => {
    const forwarder: InstanceType<typeof LspApplyEditForwarder> = new LspApplyEditForwarder();
    const targets: (WebContents | null)[] = [];
    vi.spyOn(forwarder, 'forward').mockImplementation(
      (_sessionId: string, target: WebContents | null): Promise<ApplyEditResult> => {
        targets.push(target);
        return Promise.resolve({ applied: false });
      },
    );
    const main: WebContents = contents();
    const manager: InstanceType<typeof LspManager> = new LspManager(
      (): BrowserWindow | null =>
        ({ isDestroyed: (): boolean => false, webContents: main }) as unknown as BrowserWindow,
      new WorkspaceContext(),
      {} as LspServerRegistry,
      forwarder,
    );
    const connection: FakeConnection = fakeConnection();
    (manager as unknown as ManagerInternals).answerServerRequests(connection, 's1', {
      clients: new Map<WebContents, number>(),
    });

    await connection.handlers.get('workspace/applyEdit')?.({ edit: {} });

    expect(targets).toEqual([main]);
  });
});
