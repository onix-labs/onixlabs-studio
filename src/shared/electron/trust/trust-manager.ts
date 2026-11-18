import { homedir } from 'node:os';
import * as path from 'node:path';
import { ipcMain, IpcMainInvokeEvent } from 'electron';
import type { RepositoryTrustDecision } from '@shared/api/source-control-channels';
import {
  TrustChannel,
  type TrustAnswer,
  type TrustChange,
  type TrustScanRequest,
} from '@shared/api/trust-channels';
import { logger } from '../logger';
import type { RepositoryTrustChoice } from '../repository-trust';
import type { TrustAsker } from './trust-asker';

/**
 * The part of the trust store the manager reads and writes.
 */
export interface TrustStore {
  /**
   * Gets what the user decided about a folder.
   * @param target The folder.
   * @returns Returns the decision.
   */
  decisionFor(target: unknown): RepositoryTrustDecision;

  /**
   * Records what the user decided about a folder.
   * @param target The folder.
   * @param choice The decision.
   */
  decide(target: string, choice: RepositoryTrustChoice): void;
}

/**
 * The part of the workspace the manager checks a folder against.
 */
export interface TrustScope {
  /**
   * Gets the open workspace roots.
   * @returns Returns their absolute paths.
   */
  openRoots(): readonly string[];

  /**
   * Gets whether the user opened a file that lies directly in a folder: a file opened on its own,
   * outside any workspace, whose folder its language server would run in.
   * @param folder The resolved folder.
   * @returns Returns true when they did.
   */
  holdsOpenedFileIn(folder: string): boolean;
}

/**
 * What a part of the main process that serves a renderer's trust request may do: read a decision, ask
 * the user (through the main process's own prompt) or lower trust. It cannot record "trusted" itself,
 * so neither can a renderer it serves.
 */
export interface TrustGrants {
  /**
   * Gets what the user decided about a folder.
   * @param target The folder.
   * @returns Returns the decision.
   */
  decisionFor(target: unknown): RepositoryTrustDecision;

  /**
   * Asks the user whether they trust a folder Studio has open.
   * @param folder The folder, untrusted.
   * @returns Returns the decision in force afterwards.
   */
  ask(folder: unknown): Promise<RepositoryTrustDecision>;

  /**
   * Records that the user does not trust a folder.
   * @param folder The folder, untrusted.
   * @returns Returns the decision in force afterwards.
   */
  restrict(folder: unknown): RepositoryTrustDecision;
}

/**
 * Owns the question "do you trust this folder?" (#1504): asked for every folder Studio opens, whatever
 * plugins are installed, before anything runs from it.
 *
 * The main process owns the question: {@link ask} decides when to put it, one folder at a time, and
 * records the answer here. A renderer asking for trust gets the question, never the decision it
 * named. Lowering trust needs no question: {@link restrict} records it directly.
 */
export class TrustManager implements TrustGrants {
  /**
   * Holds the trust store.
   */
  private readonly store: TrustStore;

  /**
   * Holds the workspace the folders asked about must belong to.
   */
  private readonly scope: TrustScope;

  /**
   * Holds the prompt that asks the user.
   */
  private readonly asker: TrustAsker;

  /**
   * Tells every window that a folder's decision changed.
   */
  private readonly announce: (change: TrustChange) => void;

  /**
   * Tells every window that the user asked for a folder to be scanned before deciding.
   */
  private readonly requestScan: (request: TrustScanRequest) => void;

  /**
   * Holds each question being asked, by folder, so a second request for it shares the first's answer.
   */
  private readonly inFlight: Map<string, Promise<RepositoryTrustDecision>> = new Map<
    string,
    Promise<RepositoryTrustDecision>
  >();

  /**
   * Holds the end of the queue, so one folder is asked about at a time.
   */
  private queue: Promise<unknown> = Promise.resolve();

  /**
   * Initializes a new instance of the {@link TrustManager} class.
   * @param store The trust store.
   * @param scope The workspace the folders asked about must belong to.
   * @param asker The prompt that asks the user.
   * @param announce Tells every window that a folder's decision changed.
   * @param requestScan Tells every window that the user asked for a folder to be scanned first.
   */
  public constructor(
    store: TrustStore,
    scope: TrustScope,
    asker: TrustAsker,
    announce: (change: TrustChange) => void,
    requestScan: (request: TrustScanRequest) => void = (): void => undefined,
  ) {
    this.store = store;
    this.scope = scope;
    this.asker = asker;
    this.announce = announce;
    this.requestScan = requestScan;
  }

  /**
   * Registers the trust IPC handlers.
   */
  public register(): void {
    ipcMain.handle(
      TrustChannel.State,
      (_event: IpcMainInvokeEvent, folder: unknown): RepositoryTrustDecision => this.state(folder),
    );
    ipcMain.handle(
      TrustChannel.Ask,
      (_event: IpcMainInvokeEvent, folder: unknown): Promise<RepositoryTrustDecision> =>
        this.ask(folder),
    );
    logger.info('TrustManager', 'Registered trust IPC handlers');
  }

  /**
   * Gets what the user decided about a folder, wherever it is: what the gates read.
   * @param target The folder.
   * @returns Returns the decision.
   */
  public decisionFor(target: unknown): RepositoryTrustDecision {
    return this.store.decisionFor(target);
  }

  /**
   * Gets what the user decided about a folder Studio has open.
   * @param folder The folder, untrusted.
   * @returns Returns the decision, or `unknown` for a folder outside the workspace.
   */
  public state(folder: unknown): RepositoryTrustDecision {
    const resolved: string | null = this.inScope(folder);
    return resolved === null ? 'unknown' : this.store.decisionFor(resolved);
  }

  /**
   * Asks the user whether they trust a folder Studio has open, unless they already do. A folder they
   * did not trust is asked about again: asking is how they change their mind.
   * @param folder The folder, untrusted.
   * @returns Returns the decision in force afterwards.
   */
  public ask(folder: unknown): Promise<RepositoryTrustDecision> {
    const resolved: string | null = this.inScope(folder);
    if (resolved === null) {
      logger.warn('TrustManager', 'Refused to ask about a folder Studio does not have open');
      return Promise.resolve('unknown');
    }
    if (this.store.decisionFor(resolved) === 'trusted') {
      return Promise.resolve('trusted');
    }
    const shared: Promise<RepositoryTrustDecision> | undefined = this.inFlight.get(resolved);
    if (shared !== undefined) {
      return shared;
    }
    const asked: Promise<RepositoryTrustDecision> = this.queue.then(
      (): Promise<RepositoryTrustDecision> => this.askNow(resolved),
    );
    this.inFlight.set(resolved, asked);
    this.queue = asked.catch((): void => undefined);
    void asked.finally((): void => {
      this.inFlight.delete(resolved);
    });
    return asked;
  }

  /**
   * Records that the user does not trust a folder. Lowering trust is safe, so it needs no question.
   * @param folder The folder, untrusted.
   * @returns Returns the decision in force afterwards.
   */
  public restrict(folder: unknown): RepositoryTrustDecision {
    const resolved: string | null = this.inScope(folder);
    if (resolved === null) {
      return 'unknown';
    }
    this.record(resolved, 'restricted');
    return this.store.decisionFor(resolved);
  }

  /**
   * Puts the question, records the answer and tells every window.
   * @param folder The resolved folder.
   * @returns Returns the decision in force afterwards.
   */
  private async askNow(folder: string): Promise<RepositoryTrustDecision> {
    // Another question may have settled it while this one waited its turn.
    if (this.store.decisionFor(folder) === 'trusted') {
      return 'trusted';
    }
    let answer: TrustAnswer;
    try {
      answer = await this.asker.ask({
        name: path.basename(folder) || folder,
        folder,
        scannable: this.scope.openRoots().includes(folder),
      });
    } catch (error: unknown) {
      logger.error('TrustManager', 'The trust question could not be asked', error);
      return this.store.decisionFor(folder);
    }
    if (answer === 'scan') {
      // Scanning decides nothing: the folder stays as it was until the user answers, having read the
      // report. The scan itself only reads the folder.
      logger.info('TrustManager', `Scan requested for ${folder}`);
      this.requestScan({ folder });
      return this.store.decisionFor(folder);
    }
    this.record(folder, answer);
    return this.store.decisionFor(folder);
  }

  /**
   * Records a decision and tells every window.
   * @param folder The resolved folder.
   * @param choice The decision.
   */
  private record(folder: string, choice: RepositoryTrustChoice): void {
    this.store.decide(folder, choice);
    this.announce({ folder, decision: this.store.decisionFor(folder) });
  }

  /**
   * Resolves a folder a renderer named, when Studio has it open: an open root, a folder within one, the
   * repository an open root lies in, or the folder of a file the user opened on its own.
   * @param folder The folder, untrusted.
   * @returns Returns the resolved folder, or null when it is not one Studio has open.
   */
  private inScope(folder: unknown): string | null {
    if (typeof folder !== 'string' || folder.length === 0 || !path.isAbsolute(folder)) {
      return null;
    }
    const resolved: string = path.resolve(folder);
    // A decision covers everything beneath it, so the disk or the home folder is never asked about,
    // even when a workspace lies within it: trusting either would trust every folder on it.
    if (resolved === path.parse(resolved).root || resolved === path.resolve(homedir())) {
      return null;
    }
    const related: boolean = this.scope
      .openRoots()
      .some((root: string): boolean => within(resolved, root) || within(root, resolved));
    return related || this.scope.holdsOpenedFileIn(resolved) ? resolved : null;
  }
}

/**
 * Determines whether a path is a folder or lies within it.
 * @param target The path.
 * @param folder The folder.
 * @returns Returns true when it does.
 */
function within(target: string, folder: string): boolean {
  const relative: string = path.relative(path.resolve(folder), target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
