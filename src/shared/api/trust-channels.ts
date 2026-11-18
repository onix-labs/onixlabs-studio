import type { RepositoryTrustDecision } from './source-control-channels';

/**
 * Names the IPC channels for folder trust (#1504). Nothing runs from a folder until the user has
 * trusted it. The main process owns the question: it asks one folder at a time, in the application
 * window, and records the answer itself.
 */
export enum TrustChannel {
  /**
   * Reads what the user decided about a folder, asking nothing (invoke).
   */
  State = 'trust:state',

  /**
   * Asks the user whether they trust a folder, in the main process's own window, and answers with
   * the decision recorded: at once when it is already trusted (invoke).
   */
  Ask = 'trust:ask',

  /**
   * Tells every window that a folder's decision changed, so what waited on it can start (main →
   * renderer, send).
   */
  Changed = 'trust:changed',

  /**
   * Tells every window that the user asked for a folder to be scanned for threats before deciding,
   * leaving it undecided (main → renderer, send). The workspace showing it starts a read-only agent.
   */
  ScanRequested = 'trust:scan-requested',

  /**
   * Puts the trust question to the user in the application window (main → renderer, send): a
   * {@link TrustQuestionRequest}. The main process asks one folder at a time.
   */
  Question = 'trust:question',

  /**
   * Gives the user's answer to a question the main process asked (invoke): its identifier and a
   * {@link TrustAnswer}. An answer to a question that was never asked, or one already answered, is
   * ignored.
   */
  Answer = 'trust:answer',
}

/**
 * Describes a change to a folder's trust, as {@link TrustChannel.Changed} reports it.
 */
export interface TrustChange {
  /**
   * Gets the folder the decision is about.
   */
  readonly folder: string;

  /**
   * Gets the decision now in force.
   */
  readonly decision: RepositoryTrustDecision;
}

/**
 * Describes the folder a trust prompt asks about.
 */
export interface TrustQuestion {
  /**
   * Gets the folder's name, for the prompt's title.
   */
  readonly name: string;

  /**
   * Gets the folder's absolute path.
   */
  readonly folder: string;

  /**
   * Gets whether the prompt offers Scan with AI: only for a workspace Studio has open, which is where
   * the scanning agent runs.
   */
  readonly scannable: boolean;

  /**
   * Gets the address a clone would come from, when the question is asked before cloning (#1504):
   * nothing is downloaded until it is answered. Undefined for a folder already on disk.
   */
  readonly source?: string;
}

/**
 * Lists the answers a trust prompt can give: trust it, don't, scan it first, decide once it is cloned,
 * or (for a clone) not clone it at all.
 */
export type TrustAnswer = 'trusted' | 'restricted' | 'scan' | 'later' | 'cancel';

/**
 * Determines whether a value is a {@link TrustAnswer}.
 * @param value The value, untrusted.
 * @returns Returns true when it is one.
 */
export function isTrustAnswer(value: unknown): value is TrustAnswer {
  return (
    value === 'trusted' ||
    value === 'restricted' ||
    value === 'scan' ||
    value === 'later' ||
    value === 'cancel'
  );
}

/**
 * Describes a folder the user asked to have scanned, as {@link TrustChannel.ScanRequested} reports it.
 */
export interface TrustScanRequest {
  /**
   * Gets the folder to scan.
   */
  readonly folder: string;
}

/**
 * Describes a question the main process puts to the user, as {@link TrustChannel.Question} sends it.
 */
export interface TrustQuestionRequest {
  /**
   * Gets the question's identifier, which its answer carries back.
   */
  readonly id: number;

  /**
   * Gets the folder asked about.
   */
  readonly question: TrustQuestion;
}
