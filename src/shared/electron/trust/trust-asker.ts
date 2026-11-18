import { BrowserWindow, ipcMain, IpcMainInvokeEvent } from 'electron';
import {
  isTrustAnswer,
  TrustChannel,
  type TrustAnswer,
  type TrustQuestion,
  type TrustQuestionRequest,
} from '@shared/api/trust-channels';
import { logger } from '../logger';

/**
 * Puts the trust question to the user, answering with their choice.
 */
export interface TrustAsker {
  /**
   * Asks the user whether they trust a folder.
   * @param question The folder to ask about.
   * @returns Returns the user's answer; a question that cannot be put is not trusting the folder.
   */
  ask(question: TrustQuestion): Promise<TrustAnswer>;
}

/**
 * Asks the trust question in the application window (#1504), where Studio's own dialog shows it.
 *
 * The main process stays the owner of the question: {@link import('./trust-manager').TrustManager}
 * decides when to ask and records the answer. Each question carries an identifier, so an answer is
 * taken only for a question actually asked, once. A question that cannot be put — no window — or
 * whose window goes away before it is answered, is not trusting the folder.
 */
export class WindowTrustAsker implements TrustAsker {
  /**
   * Gets the window the question is put in.
   */
  private readonly window: () => BrowserWindow | null;

  /**
   * Holds the identifier the next question is given.
   */
  private nextId: number = 1;

  /**
   * Holds the questions awaiting an answer, by identifier.
   */
  private readonly pending: Map<number, (answer: TrustAnswer) => void> = new Map<
    number,
    (answer: TrustAnswer) => void
  >();

  /**
   * Initializes a new instance of the {@link WindowTrustAsker} class.
   * @param window Gets the window the question is put in.
   */
  public constructor(window: () => BrowserWindow | null) {
    this.window = window;
  }

  /**
   * Registers the answer handler.
   */
  public register(): void {
    ipcMain.handle(
      TrustChannel.Answer,
      (_event: IpcMainInvokeEvent, id: unknown, answer: unknown): boolean =>
        this.answer(id, answer),
    );
  }

  /**
   * Asks the user whether they trust a folder.
   * @param question The folder to ask about.
   * @returns Returns the user's answer.
   */
  public ask(question: TrustQuestion): Promise<TrustAnswer> {
    const window: BrowserWindow | null = this.window();
    if (window === null || window.isDestroyed()) {
      logger.warn('WindowTrustAsker', `No window to ask about ${question.folder}; not trusted`);
      return Promise.resolve('restricted');
    }
    const id: number = this.nextId++;
    return new Promise<TrustAnswer>((resolve: (answer: TrustAnswer) => void): void => {
      const settle: (answer: TrustAnswer) => void = (answer: TrustAnswer): void => {
        if (this.pending.delete(id)) {
          window.removeListener('closed', closed);
          resolve(answer);
        }
      };
      // A window closed with the question unanswered is not trusting the folder.
      const closed: () => void = (): void => settle('restricted');
      this.pending.set(id, settle);
      window.once('closed', closed);
      const request: TrustQuestionRequest = { id, question };
      window.webContents.send(TrustChannel.Question, request);
      logger.info('WindowTrustAsker', `Asking whether ${question.folder} is trusted`);
    });
  }

  /**
   * Takes the user's answer to a question that was asked and not yet answered.
   * @param id The question's identifier, untrusted.
   * @param answer The answer, untrusted.
   * @returns Returns true when it answered a question.
   */
  private answer(id: unknown, answer: unknown): boolean {
    const settle: ((answer: TrustAnswer) => void) | undefined =
      typeof id === 'number' ? this.pending.get(id) : undefined;
    if (settle === undefined || !isTrustAnswer(answer)) {
      logger.warn('WindowTrustAsker', 'Ignored an answer to a question that was not asked');
      return false;
    }
    settle(answer);
    return true;
  }
}
