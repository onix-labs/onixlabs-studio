import { randomUUID } from 'node:crypto';
import { ipcMain, IpcMainEvent, WebContents } from 'electron';
import {
  LspAttachDebuggerReply,
  LspAttachDebuggerRequest,
  LspChannel,
} from '@shared/api/lsp-channels';
import { logger } from '../logger';

/**
 * How long a server waits for the renderer to attach the debugger before it is told the debugger did
 * not: long enough for the debug adapter to start and attach, never forever — the test host waits
 * for the answer.
 */
export const ATTACH_DEBUGGER_TIMEOUT_MS: number = 60_000;

/**
 * A forwarded attach waiting for the renderer's answer.
 */
interface PendingAttach {
  readonly target: WebContents;
  readonly resolve: (didAttach: boolean) => void;
  readonly timer: NodeJS.Timeout;
  readonly detach: () => void;
}

/**
 * Answers a server's `workspace/attachDebugger` (#1150) — Roslyn's, starting a test host for Debug
 * Test and waiting in it for a debugger — by asking the renderer that holds the session to attach the
 * workspace's debugger to the process, and telling the server whether it did. The renderer that
 * closes, or never answers, has not attached; the test then runs on without a debugger.
 */
export class LspAttachDebuggerForwarder {
  /**
   * Holds the attaches waiting for the renderer's answer, keyed by request identifier.
   */
  private readonly pending: Map<string, PendingAttach> = new Map<string, PendingAttach>();

  /**
   * Initializes a new instance of the {@link LspAttachDebuggerForwarder} class.
   * @param timeoutMs How long to wait for the renderer.
   */
  public constructor(private readonly timeoutMs: number = ATTACH_DEBUGGER_TIMEOUT_MS) {}

  /**
   * Registers the reply handler.
   */
  public register(): void {
    ipcMain.on(LspChannel.AttachDebuggerReply, (event: IpcMainEvent, reply: unknown): void =>
      this.settle(event.sender, reply),
    );
  }

  /**
   * Forwards a server's attach request to the renderer holding its session, and answers with whether
   * the debugger attached.
   * @param sessionId The session whose server asked.
   * @param target The renderer to attach in, or null when none holds the session.
   * @param params The request's parameters, untrusted: `{ processId }`.
   * @returns Returns the answer for the server: `{ didAttach }`.
   */
  public async forward(
    sessionId: string,
    target: WebContents | null,
    params: unknown,
  ): Promise<{ didAttach: boolean }> {
    const processId: unknown = (params as { processId?: unknown } | null)?.processId;
    if (typeof processId !== 'number' || !Number.isInteger(processId) || processId <= 0) {
      logger.warn('LspAttachDebugger', `Session ${sessionId} asked to attach to no process`);
      return { didAttach: false };
    }
    if (target === null || target.isDestroyed()) {
      logger.warn('LspAttachDebugger', `No window holds session ${sessionId} to attach in`);
      return { didAttach: false };
    }
    const requestId: string = randomUUID();
    logger.info('LspAttachDebugger', `Asking to attach to process ${processId} (${requestId})`);
    const didAttach: boolean = await new Promise<boolean>(
      (resolve: (didAttach: boolean) => void): void => {
        const onGone: () => void = (): void => this.answer(requestId, false);
        target.once('destroyed', onGone);
        target.once('render-process-gone', onGone);
        const detach: () => void = (): void => {
          target.removeListener('destroyed', onGone);
          target.removeListener('render-process-gone', onGone);
        };
        const timer: NodeJS.Timeout = setTimeout((): void => {
          logger.warn('LspAttachDebugger', `The renderer never answered attach ${requestId}`);
          this.answer(requestId, false);
        }, this.timeoutMs);
        this.pending.set(requestId, { target, resolve, timer, detach });
        const request: LspAttachDebuggerRequest = { requestId, sessionId, processId };
        target.send(LspChannel.AttachDebugger, request);
      },
    );
    return { didAttach };
  }

  /**
   * Answers every attach still waiting, as not attached.
   */
  public dispose(): void {
    for (const requestId of [...this.pending.keys()]) {
      this.answer(requestId, false);
    }
  }

  /**
   * Settles an attach with the renderer's answer, when it comes from the renderer that was asked.
   * @param sender The renderer that answered.
   * @param reply The answer, untrusted.
   */
  private settle(sender: WebContents, reply: unknown): void {
    const candidate: Partial<Record<keyof LspAttachDebuggerReply, unknown>> | null =
      typeof reply === 'object' && reply !== null ? reply : null;
    if (typeof candidate?.requestId !== 'string' || typeof candidate.didAttach !== 'boolean') {
      return;
    }
    if (this.pending.get(candidate.requestId)?.target !== sender) {
      logger.warn('LspAttachDebugger', `Ignored an answer to attach ${candidate.requestId}`);
      return;
    }
    this.answer(candidate.requestId, candidate.didAttach);
  }

  /**
   * Settles a waiting attach.
   * @param requestId The attach.
   * @param didAttach Whether the debugger attached.
   */
  private answer(requestId: string, didAttach: boolean): void {
    const pending: PendingAttach | undefined = this.pending.get(requestId);
    if (pending === undefined) {
      return;
    }
    this.pending.delete(requestId);
    clearTimeout(pending.timer);
    pending.detach();
    logger.info(
      'LspAttachDebugger',
      `Attach ${requestId}: ${didAttach ? 'attached' : 'not attached'}`,
    );
    pending.resolve(didAttach);
  }
}
