import { randomUUID } from 'node:crypto';
import { ipcMain, IpcMainEvent, WebContents } from 'electron';
import { LspChannel, LspShowMessageReply, LspShowMessageRequest } from '@shared/api/lsp-channels';
import { logger } from '../logger';

/**
 * How long a server's question waits for the user before it is answered as dismissed. The question
 * sits in a toast that stays until it is answered; this only stops a renderer that never answers from
 * leaving the server's request open for the rest of the session.
 */
export const SHOW_MESSAGE_TIMEOUT_MS: number = 600_000;

/**
 * A forwarded question waiting for the user's answer.
 */
interface PendingQuestion {
  readonly target: WebContents;
  readonly actions: readonly unknown[];
  readonly resolve: (action: unknown) => void;
  readonly timer: NodeJS.Timeout;
  readonly detach: () => void;
}

/**
 * Answers a server's `window/showMessageRequest` (#1154) — a question for the user, with the actions
 * it may be answered by ("Import project?" — Yes / No) — by asking the renderer that holds the session
 * to put it to the user, and answering the server with the action chosen, exactly as the server sent
 * it (any properties beyond its title included, which the client advertises it preserves). A question
 * dismissed, or put to a renderer that closes or never answers, is answered null.
 */
export class LspShowMessageForwarder {
  /**
   * Holds the questions waiting for an answer, keyed by request identifier.
   */
  private readonly pending: Map<string, PendingQuestion> = new Map<string, PendingQuestion>();

  /**
   * Initializes a new instance of the {@link LspShowMessageForwarder} class.
   * @param timeoutMs How long to wait for the user.
   */
  public constructor(private readonly timeoutMs: number = SHOW_MESSAGE_TIMEOUT_MS) {}

  /**
   * Registers the reply handler.
   */
  public register(): void {
    ipcMain.on(LspChannel.ShowMessageReply, (event: IpcMainEvent, reply: unknown): void =>
      this.settle(event.sender, reply),
    );
  }

  /**
   * Forwards a server's question to the renderer holding its session, and answers with the action the
   * user chose.
   * @param sessionId The session whose server asked.
   * @param target The renderer to ask in, or null when none holds the session.
   * @param params The request's parameters, untrusted: `{ type, message, actions? }`.
   * @returns Returns the answer for the server: the chosen `MessageActionItem`, or null.
   */
  public async forward(
    sessionId: string,
    target: WebContents | null,
    params: unknown,
  ): Promise<unknown> {
    const candidate: { type?: unknown; message?: unknown; actions?: unknown } | null =
      typeof params === 'object' && params !== null ? params : null;
    const message: unknown = candidate?.message;
    if (typeof message !== 'string' || message.trim().length === 0) {
      return null;
    }
    const actions: readonly unknown[] = Array.isArray(candidate?.actions) ? candidate.actions : [];
    const titles: string[] = actions.map((action: unknown): string => {
      const title: unknown = (action as { title?: unknown } | null)?.title;
      return typeof title === 'string' ? title : '';
    });
    if (target === null || target.isDestroyed()) {
      logger.warn('LspShowMessage', `No window holds session ${sessionId} to ask in`);
      return null;
    }
    const requestId: string = randomUUID();
    logger.info('LspShowMessage', `Asking the user for session ${sessionId} (${requestId})`);
    return new Promise<unknown>((resolve: (action: unknown) => void): void => {
      const onGone: () => void = (): void => this.answer(requestId, null);
      target.once('destroyed', onGone);
      target.once('render-process-gone', onGone);
      const detach: () => void = (): void => {
        target.removeListener('destroyed', onGone);
        target.removeListener('render-process-gone', onGone);
      };
      const timer: NodeJS.Timeout = setTimeout((): void => {
        logger.warn('LspShowMessage', `Question ${requestId} was never answered`);
        this.answer(requestId, null);
      }, this.timeoutMs);
      this.pending.set(requestId, { target, actions, resolve, timer, detach });
      const request: LspShowMessageRequest = {
        requestId,
        sessionId,
        type: typeof candidate?.type === 'number' ? candidate.type : 3,
        message,
        actions: titles,
      };
      target.send(LspChannel.ShowMessage, request);
    });
  }

  /**
   * Answers every question still waiting as dismissed.
   */
  public dispose(): void {
    for (const requestId of [...this.pending.keys()]) {
      this.answer(requestId, null);
    }
  }

  /**
   * Settles a question with the renderer's answer, when it comes from the renderer that was asked and
   * names an action that was offered.
   * @param sender The renderer that answered.
   * @param reply The answer, untrusted.
   */
  private settle(sender: WebContents, reply: unknown): void {
    const candidate: Partial<Record<keyof LspShowMessageReply, unknown>> | null =
      typeof reply === 'object' && reply !== null ? reply : null;
    if (typeof candidate?.requestId !== 'string') {
      return;
    }
    const pending: PendingQuestion | undefined = this.pending.get(candidate.requestId);
    if (pending?.target !== sender) {
      logger.warn('LspShowMessage', `Ignored an answer to question ${candidate.requestId}`);
      return;
    }
    const index: unknown = candidate.action;
    this.answer(
      candidate.requestId,
      typeof index === 'number' && Number.isInteger(index) && index >= 0
        ? (pending.actions[index] ?? null)
        : null,
    );
  }

  /**
   * Settles a waiting question.
   * @param requestId The question.
   * @param action The action chosen, or null.
   */
  private answer(requestId: string, action: unknown): void {
    const pending: PendingQuestion | undefined = this.pending.get(requestId);
    if (pending === undefined) {
      return;
    }
    this.pending.delete(requestId);
    clearTimeout(pending.timer);
    pending.detach();
    logger.info(
      'LspShowMessage',
      `Question ${requestId}: ${action === null ? 'dismissed' : 'answered'}`,
    );
    pending.resolve(action);
  }
}
