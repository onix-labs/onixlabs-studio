import * as path from 'node:path';
import { BrowserWindow, ipcMain, IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron';
import {
  isTrustAnswer,
  TrustPromptChannel,
  type TrustAnswer,
  type TrustQuestion,
} from '@shared/api/trust-channels';
import { logger } from '../logger';
import { trustPromptUrl } from './trust-prompt-page';

/**
 * Puts the trust question to the user, answering with their choice.
 */
export interface TrustAsker {
  /**
   * Asks the user whether they trust a folder.
   * @param question The folder to ask about.
   * @returns Returns the user's answer; dismissing the question is not trusting the folder.
   */
  ask(question: TrustQuestion): Promise<TrustAnswer>;
}

/**
 * Holds one prompt on screen: what it asks, and how its answer is delivered.
 */
interface OpenPrompt {
  /**
   * Gets the folder it asks about.
   */
  readonly question: TrustQuestion;

  /**
   * Delivers the answer, once.
   */
  readonly settle: (answer: TrustAnswer) => void;
}

/**
 * Asks the trust question in a window the main process opens and owns (#1504).
 *
 * ⛔ The renderer must never be able to answer this question: once it is answered, the folder's code
 * may run. So the prompt is not one of the renderer's modals. It is its own window, with its own page
 * (no script, a closed content security policy) and its own preload, and the main process takes an
 * answer only from the window it opened for that question.
 */
export class TrustPrompt implements TrustAsker {
  /**
   * Holds the prompt preload's path.
   */
  private readonly preloadPath: string;

  /**
   * Gets the window the prompt is shown over, or null to show it on its own.
   */
  private readonly parent: () => BrowserWindow | null;

  /**
   * Holds the prompts on screen, by their window's web contents.
   */
  private readonly open: Map<number, OpenPrompt> = new Map<number, OpenPrompt>();

  /**
   * Initializes a new instance of the {@link TrustPrompt} class.
   * @param preloadPath The prompt preload's path.
   * @param parent Gets the window the prompt is shown over.
   */
  public constructor(preloadPath: string, parent: () => BrowserWindow | null) {
    this.preloadPath = preloadPath;
    this.parent = parent;
  }

  /**
   * Gets the prompt preload's path beside the main process's bundle.
   * @param directory The directory the main bundle runs from.
   * @returns Returns the path.
   */
  public static preloadIn(directory: string): string {
    return path.join(directory, 'trust-prompt-preload.js');
  }

  /**
   * Registers the prompt's IPC handlers. Each answers only a window this prompt opened.
   */
  public register(): void {
    ipcMain.handle(
      TrustPromptChannel.Question,
      (event: IpcMainInvokeEvent): TrustQuestion | null =>
        this.open.get(event.sender.id)?.question ?? null,
    );
    ipcMain.on(TrustPromptChannel.Answer, (event: IpcMainEvent, answer: unknown): void => {
      const prompt: OpenPrompt | undefined = this.open.get(event.sender.id);
      if (prompt === undefined || !isTrustAnswer(answer)) {
        logger.warn('TrustPrompt', 'Ignored an answer from a window that was not asked');
        return;
      }
      prompt.settle(answer);
    });
  }

  /**
   * Asks the user whether they trust a folder, in a window of the main process's own.
   * @param question The folder to ask about.
   * @returns Returns the user's answer.
   */
  public ask(question: TrustQuestion): Promise<TrustAnswer> {
    const parent: BrowserWindow | null = this.parent();
    const window: BrowserWindow = new BrowserWindow({
      width: 520,
      height: 370,
      useContentSize: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      show: false,
      title: 'Do you trust this folder?',
      ...(parent !== null && !parent.isDestroyed() && parent.isVisible()
        ? { parent, modal: true }
        : {}),
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
      },
    });
    window.setMenu(null);
    const contents: WebContents = window.webContents;
    const id: number = contents.id;
    logger.info('TrustPrompt', `Asking whether ${question.folder} is trusted`);
    return new Promise<TrustAnswer>((resolve: (answer: TrustAnswer) => void): void => {
      let settled: boolean = false;
      const settle: (answer: TrustAnswer) => void = (answer: TrustAnswer): void => {
        if (settled) {
          return;
        }
        settled = true;
        this.open.delete(id);
        logger.info('TrustPrompt', `${question.folder}: ${answer}`);
        resolve(answer);
        if (!window.isDestroyed()) {
          window.close();
        }
      };
      this.open.set(id, { question, settle });
      // Closing the window is not trusting the folder.
      window.on('closed', (): void => settle('restricted'));
      window.once('ready-to-show', (): void => window.show());
      void window.loadURL(trustPromptUrl()).catch((error: unknown): void => {
        logger.error('TrustPrompt', 'The trust prompt could not be shown', error);
        settle('restricted');
      });
    });
  }
}
