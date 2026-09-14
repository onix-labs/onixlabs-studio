/**
 * The phase a conversation is in, as far as its controls are concerned.
 *
 * - `empty`: no messages yet — nothing to clear, compact, or stop.
 * - `idle`: a transcript exists and no run is in flight.
 * - `working`: a run is in flight and the agent is doing something.
 * - `waiting`: a run is in flight and blocked on the user — a permission decision, a question, an edit
 *   to apply or reject.
 */
export type AgentPhase = 'empty' | 'idle' | 'working' | 'waiting';

/**
 * Which of a conversation's controls are enabled. One shape for every surface that shows them — the
 * standalone tab's ribbon and the docked panel's tool strip — so the two can never disagree.
 */
export interface AgentControls {
  /**
   * Gets whether New Chat may clear the transcript.
   */
  readonly newChat: boolean;

  /**
   * Gets whether Stop may halt the run.
   */
  readonly stop: boolean;

  /**
   * Gets whether Compact may summarise the transcript.
   */
  readonly compact: boolean;

  /**
   * Gets whether Remote Control may be toggled.
   */
  readonly remoteControl: boolean;

  /**
   * Gets whether the provider / model (and autonomy mode) may be changed.
   */
  readonly engine: boolean;

  /**
   * Gets whether files, folders and the editor selection may be attached. A surface still gates the
   * selection button on a selection actually existing; this says whether attaching is possible at all.
   */
  readonly attach: boolean;
}

/**
 * Resolves a conversation's phase from the three facts that decide it.
 * @param hasMessages Whether the transcript holds anything.
 * @param isRunning Whether a run is in flight.
 * @param awaitingDecision Whether that run is blocked on the user.
 * @returns Returns the phase.
 */
export function agentPhase(
  hasMessages: boolean,
  isRunning: boolean,
  awaitingDecision: boolean,
): AgentPhase {
  if (isRunning) {
    return awaitingDecision ? 'waiting' : 'working';
  }
  return hasMessages ? 'idle' : 'empty';
}

/**
 * The table every agent control is enabled from.
 *
 * | Action         | Empty | Idle | Working | Waiting |
 * | -------------- | ----- | ---- | ------- | ------- |
 * | New Chat       |   –   |  ✓   |    –    |    –    |
 * | Stop           |   –   |  –   |    ✓    |    ✓    |
 * | Compact        |   –   |  ✓   |    –    |    –    |
 * | Remote Control |   ✓   |  ✓   |    ✓    |    ✓    |
 * | Engine         |   ✓   |  ✓   |    –    |    –    |
 * | Attach         |   ✓   |  ✓   |    –    |    –    |
 *
 * The rows with a `–` under Working and Waiting are the ones that cannot act on the run in flight: a
 * model or mode change is bound at the next turn, and an attachment rides the next turn's context, so
 * an enabled control there would be a promise the running turn cannot keep. Stop is the reverse — it
 * is the only thing that *can* act on a run, so it is offered exactly then (and while waiting, where
 * it also withdraws the pending prompt). Remote Control re-aims the live session in place, so it is
 * never withheld. New Chat while waiting would have to abort first; the user says Stop for that.
 */
const CONTROLS: Readonly<Record<AgentPhase, AgentControls>> = {
  empty: {
    newChat: false,
    stop: false,
    compact: false,
    remoteControl: true,
    engine: true,
    attach: true,
  },
  idle: {
    newChat: true,
    stop: false,
    compact: true,
    remoteControl: true,
    engine: true,
    attach: true,
  },
  working: {
    newChat: false,
    stop: true,
    compact: false,
    remoteControl: true,
    engine: false,
    attach: false,
  },
  waiting: {
    newChat: false,
    stop: true,
    compact: false,
    remoteControl: true,
    engine: false,
    attach: false,
  },
};

/**
 * Gets which controls a conversation in the given phase offers.
 * @param phase The conversation's phase.
 * @returns Returns the enabled controls.
 */
export function agentControls(phase: AgentPhase): AgentControls {
  return CONTROLS[phase];
}
