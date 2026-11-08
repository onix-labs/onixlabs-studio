import { randomUUID } from 'node:crypto';
import { ipcMain, IpcMainEvent, WebContents } from 'electron';
import { LspChannel, LspIndentationReply, LspIndentationRequest } from '@shared/api/lsp-channels';
import { logger } from '../logger';

/**
 * How long a server's configuration request waits for the renderer to say how a document is indented
 * before it is answered without: a server waits for the whole answer, and the renderer only reads an
 * open model.
 */
export const INDENTATION_TIMEOUT_MS: number = 2_000;

/**
 * The settings a server asks for that are a document's indentation (#1208), by the section it names
 * each with.
 */
export interface LspIndentationSections {
  /**
   * Gets the section that is the tab size, such as `java.format.tabSize`.
   */
  readonly tabSize: string;

  /**
   * Gets the section that is whether to indent with spaces, such as `java.format.insertSpaces`.
   */
  readonly insertSpaces: string;
}

/**
 * A document's indentation, as the renderer reads it from the document's editor.
 */
export interface LspIndentation {
  /**
   * Gets the tab size, or null when no editor holds the document.
   */
  readonly tabSize: number | null;

  /**
   * Gets whether it indents with spaces, or null when no editor holds the document.
   */
  readonly insertSpaces: boolean | null;
}

/**
 * The answer given when the renderer does not: nothing, so the server keeps its own default.
 */
const UNKNOWN: LspIndentation = { tabSize: null, insertSpaces: null };

/**
 * A forwarded question waiting for the renderer's answer.
 */
interface PendingIndentation {
  readonly target: WebContents;
  readonly resolve: (indentation: LspIndentation) => void;
  readonly timer: NodeJS.Timeout;
}

/**
 * Answers the part of a server's `workspace/configuration` that is a document's indentation (#1208):
 * jdtls asks for `java.format.tabSize` and `java.format.insertSpaces` for each file it opens, and
 * indents the code it generates — a getter, a quick fix's new method — with them. Unanswered it uses
 * tabs, whatever the file uses. The renderer holding the session answers from the document's editor,
 * which knows the file's `.editorconfig`, the user's settings and what the file itself uses.
 */
export class LspIndentationForwarder {
  /**
   * Holds the questions waiting for the renderer's answer, keyed by request identifier.
   */
  private readonly pending: Map<string, PendingIndentation> = new Map<string, PendingIndentation>();

  /**
   * Initializes a new instance of the {@link LspIndentationForwarder} class.
   * @param timeoutMs How long to wait for the renderer.
   */
  public constructor(private readonly timeoutMs: number = INDENTATION_TIMEOUT_MS) {}

  /**
   * Registers the reply handler.
   */
  public register(): void {
    ipcMain.on(LspChannel.IndentationReply, (event: IpcMainEvent, reply: unknown): void =>
      this.settle(event.sender, reply),
    );
  }

  /**
   * Answers a server's configuration request, filling the items that are a document's indentation
   * from the renderer holding its session and leaving the rest as they were answered.
   * @param sessionId The session whose server asked.
   * @param target The renderer to ask, or null when none holds the session.
   * @param sections The sections that are indentation for this server.
   * @param items The requested items, untrusted.
   * @param answers The answers already given, one per item.
   * @returns Returns the answers, one per item.
   */
  public async fill(
    sessionId: string,
    target: WebContents | null,
    sections: LspIndentationSections,
    items: readonly unknown[] | undefined,
    answers: readonly unknown[],
  ): Promise<unknown[]> {
    const filled: unknown[] = [...answers];
    const asked: Map<string, Promise<LspIndentation>> = new Map<string, Promise<LspIndentation>>();
    for (const [index, item] of (items ?? []).entries()) {
      const { section, scopeUri } = (item ?? {}) as { section?: unknown; scopeUri?: unknown };
      if (
        (section !== sections.tabSize && section !== sections.insertSpaces) ||
        typeof scopeUri !== 'string' ||
        !scopeUri.startsWith('file:')
      ) {
        continue;
      }
      let indentation: Promise<LspIndentation> | undefined = asked.get(scopeUri);
      if (indentation === undefined) {
        indentation = this.ask(sessionId, target, scopeUri);
        asked.set(scopeUri, indentation);
      }
      const known: LspIndentation = await indentation;
      filled[index] = section === sections.tabSize ? known.tabSize : known.insertSpaces;
    }
    return filled;
  }

  /**
   * Answers every question still waiting, with nothing.
   */
  public dispose(): void {
    for (const requestId of [...this.pending.keys()]) {
      this.answer(requestId, UNKNOWN);
    }
  }

  /**
   * Asks the renderer how a document is indented.
   * @param sessionId The session whose server asked.
   * @param target The renderer to ask, or null when none holds the session.
   * @param uri The document.
   * @returns Returns its indentation, or nothing known when the renderer does not say.
   */
  private ask(sessionId: string, target: WebContents | null, uri: string): Promise<LspIndentation> {
    if (target === null || target.isDestroyed()) {
      return Promise.resolve(UNKNOWN);
    }
    const requestId: string = randomUUID();
    return new Promise<LspIndentation>((resolve: (indentation: LspIndentation) => void): void => {
      const timer: NodeJS.Timeout = setTimeout((): void => {
        logger.debug('LspIndentation', `The renderer never said how ${uri} is indented`);
        this.answer(requestId, UNKNOWN);
      }, this.timeoutMs);
      this.pending.set(requestId, { target, resolve, timer });
      const request: LspIndentationRequest = { requestId, sessionId, uri };
      target.send(LspChannel.Indentation, request);
    });
  }

  /**
   * Settles a question with the renderer's answer, when it comes from the renderer that was asked.
   * @param sender The renderer that answered.
   * @param reply The answer, untrusted.
   */
  private settle(sender: WebContents, reply: unknown): void {
    const candidate: Partial<Record<keyof LspIndentationReply, unknown>> | null =
      typeof reply === 'object' && reply !== null ? reply : null;
    if (typeof candidate?.requestId !== 'string') {
      return;
    }
    if (this.pending.get(candidate.requestId)?.target !== sender) {
      return;
    }
    const tabSize: unknown = candidate.tabSize;
    const insertSpaces: unknown = candidate.insertSpaces;
    this.answer(candidate.requestId, {
      tabSize:
        typeof tabSize === 'number' && Number.isInteger(tabSize) && tabSize > 0 && tabSize <= 32
          ? tabSize
          : null,
      insertSpaces: typeof insertSpaces === 'boolean' ? insertSpaces : null,
    });
  }

  /**
   * Settles a waiting question.
   * @param requestId The question.
   * @param indentation The answer.
   */
  private answer(requestId: string, indentation: LspIndentation): void {
    const pending: PendingIndentation | undefined = this.pending.get(requestId);
    if (pending === undefined) {
      return;
    }
    this.pending.delete(requestId);
    clearTimeout(pending.timer);
    pending.resolve(indentation);
  }
}
