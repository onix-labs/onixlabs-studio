import { randomUUID } from 'node:crypto';
import { ipcMain, IpcMainEvent, WebContents } from 'electron';
import { LspApplyEditReply, LspApplyEditRequest, LspChannel } from '@shared/api/lsp-channels';
import { logger } from '../logger';

/**
 * Holds how long (ms) to wait for the renderer to apply a server's edit before answering the server
 * that it was not applied. An edit is applied without asking anyone, so a renderer that has not
 * answered in this long never will.
 */
export const APPLY_EDIT_TIMEOUT_MS: number = 30_000;

/**
 * The answer a server receives to `workspace/applyEdit`: the LSP `ApplyWorkspaceEditResult`.
 */
export interface ApplyEditResult {
  /**
   * Gets whether every part of the edit was applied.
   */
  readonly applied: boolean;

  /**
   * Gets why some or all of the edit was not applied, when it was not.
   */
  readonly failureReason?: string;
}

/**
 * Tracks one edit awaiting the renderer's answer.
 */
interface PendingEdit {
  /**
   * Gets the renderer the edit was sent to, the only one whose answer is taken.
   */
  readonly target: WebContents;

  /**
   * Answers the server.
   */
  readonly resolve: (result: ApplyEditResult) => void;

  /**
   * Holds the timeout that answers the server if the renderer never does.
   */
  readonly timer: NodeJS.Timeout;

  /**
   * Removes the listeners that answer the server when the renderer goes away.
   */
  readonly detach: () => void;
}

/**
 * Forwards a language server's `workspace/applyEdit` to the renderer that holds its session (#1015),
 * where the edit is applied as a rename's is — open files in their editors, undoable, closed files on
 * disk, confined to the workspace — and answers the server with what the renderer reports. It used to
 * be answered `null` by the manager's catch-all, which a server reads as a failure it cannot explain.
 *
 * The edit goes to one renderer, never all: two windows applying the same edit would apply it twice.
 * Only that renderer's answer is taken; a renderer that goes away, or never answers, is a failure.
 */
export class LspApplyEditForwarder {
  /**
   * Holds the edits awaiting an answer, keyed by correlation id.
   */
  private readonly pending: Map<string, PendingEdit> = new Map<string, PendingEdit>();

  /**
   * Initializes a new instance of the {@link LspApplyEditForwarder} class.
   * @param timeoutMs How long to wait for the renderer's answer.
   */
  public constructor(private readonly timeoutMs: number = APPLY_EDIT_TIMEOUT_MS) {}

  /**
   * Registers the IPC listener that takes the renderer's answers.
   */
  public register(): void {
    ipcMain.on(LspChannel.ApplyEditReply, (event: IpcMainEvent, reply: unknown): void =>
      this.settle(event.sender, reply),
    );
  }

  /**
   * Forwards a server's edit to a renderer and resolves with its answer.
   * @param sessionId The session whose server asked.
   * @param target The renderer to apply it, or null when none holds the session.
   * @param params The request's parameters, untrusted: an LSP `ApplyWorkspaceEditParams`.
   * @returns Returns the answer for the server — never rejects.
   */
  public forward(
    sessionId: string,
    target: WebContents | null,
    params: unknown,
  ): Promise<ApplyEditResult> {
    const candidate: { edit?: unknown; label?: unknown } =
      typeof params === 'object' && params !== null ? params : {};
    if (typeof candidate.edit !== 'object' || candidate.edit === null) {
      logger.warn('LspApplyEdit', `Session ${sessionId} asked to apply a malformed edit`);
      return Promise.resolve({ applied: false, failureReason: 'The edit was malformed.' });
    }
    if (target === null || target.isDestroyed()) {
      logger.warn('LspApplyEdit', `No window holds session ${sessionId} to apply its edit`);
      return Promise.resolve({ applied: false, failureReason: 'No window is open to apply it.' });
    }
    const requestId: string = randomUUID();
    logger.debug('LspApplyEdit', `Forwarding session ${sessionId}'s edit (${requestId})`);
    return new Promise<ApplyEditResult>((resolve: (result: ApplyEditResult) => void): void => {
      const onGone: () => void = (): void =>
        this.answer(requestId, { applied: false, failureReason: 'The window closed.' });
      target.once('destroyed', onGone);
      target.once('render-process-gone', onGone);
      const detach: () => void = (): void => {
        target.removeListener('destroyed', onGone);
        target.removeListener('render-process-gone', onGone);
      };
      const timer: NodeJS.Timeout = setTimeout((): void => {
        logger.warn('LspApplyEdit', `The renderer never answered edit ${requestId}`);
        this.answer(requestId, { applied: false, failureReason: 'The edit timed out.' });
      }, this.timeoutMs);
      this.pending.set(requestId, { target, resolve, timer, detach });
      const request: LspApplyEditRequest = {
        requestId,
        sessionId,
        edit: candidate.edit,
        ...(typeof candidate.label === 'string' ? { label: candidate.label } : {}),
      };
      target.send(LspChannel.ApplyEdit, request);
    });
  }

  /**
   * Answers every edit still waiting as not applied. Called on shutdown.
   */
  public dispose(): void {
    for (const requestId of [...this.pending.keys()]) {
      this.answer(requestId, { applied: false, failureReason: 'Studio is closing.' });
    }
  }

  /**
   * Takes a renderer's answer, when it is from the renderer the edit went to and well formed.
   * @param sender The renderer that answered.
   * @param reply The answer, untrusted.
   */
  private settle(sender: WebContents, reply: unknown): void {
    if (typeof reply !== 'object' || reply === null) {
      return;
    }
    const candidate: Partial<Record<keyof LspApplyEditReply, unknown>> = reply;
    if (typeof candidate.requestId !== 'string' || typeof candidate.applied !== 'boolean') {
      return;
    }
    const pending: PendingEdit | undefined = this.pending.get(candidate.requestId);
    if (pending?.target !== sender) {
      logger.warn('LspApplyEdit', `Ignored an answer to edit ${candidate.requestId}`);
      return;
    }
    this.answer(candidate.requestId, {
      applied: candidate.applied,
      ...(typeof candidate.failureReason === 'string'
        ? { failureReason: candidate.failureReason }
        : {}),
    });
  }

  /**
   * Answers the server for one edit, once, releasing its timer and listeners.
   * @param requestId The edit's correlation id.
   * @param result The answer.
   */
  private answer(requestId: string, result: ApplyEditResult): void {
    const pending: PendingEdit | undefined = this.pending.get(requestId);
    if (pending === undefined) {
      return;
    }
    this.pending.delete(requestId);
    clearTimeout(pending.timer);
    pending.detach();
    logger.debug(
      'LspApplyEdit',
      `Edit ${requestId} ${result.applied ? 'applied' : `not applied: ${result.failureReason ?? ''}`}`,
    );
    pending.resolve(result);
  }
}
