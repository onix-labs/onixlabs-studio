import type { RepositoryTrustDecision } from './source-control-channels';

/**
 * Names the IPC channels for folder trust (#1504). Nothing runs from a folder until the user has
 * trusted it, and the renderer can only *ask* for that decision: the main process puts the question
 * to the user in a window of its own and records the answer itself, so no renderer code can grant
 * trust.
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
}

/**
 * Names the IPC channels between the main process and its trust prompt window. Only that window's
 * own preload uses them, and the main process answers only the window it opened.
 */
export enum TrustPromptChannel {
  /**
   * Gets the folder being asked about (invoke).
   */
  Question = 'trust-prompt:question',

  /**
   * Gives the user's answer (send).
   */
  Answer = 'trust-prompt:answer',
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
}

/**
 * Lists the answers a trust prompt can give.
 */
export type TrustAnswer = 'trusted' | 'restricted';

/**
 * Determines whether a value is a {@link TrustAnswer}.
 * @param value The value, untrusted.
 * @returns Returns true when it is one.
 */
export function isTrustAnswer(value: unknown): value is TrustAnswer {
  return value === 'trusted' || value === 'restricted';
}
