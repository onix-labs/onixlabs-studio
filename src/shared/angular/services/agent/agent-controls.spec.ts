import { describe, expect, it } from 'vitest';
import { AgentControls, AgentPhase, agentControls, agentPhase } from './agent-controls';

/**
 * The agreed table, transcribed: one row per control, one column per phase. The test is the table
 * so a change to either has to be made in both places, deliberately.
 */
const TABLE: Readonly<Record<keyof AgentControls, Readonly<Record<AgentPhase, boolean>>>> = {
  newChat: { empty: false, idle: true, working: false, waiting: false },
  stop: { empty: false, idle: false, working: true, waiting: true },
  compact: { empty: false, idle: true, working: false, waiting: false },
  remoteControl: { empty: true, idle: true, working: true, waiting: true },
  engine: { empty: true, idle: true, working: false, waiting: false },
  attach: { empty: true, idle: true, working: false, waiting: false },
};

describe('agentControls', () => {
  for (const [control, byPhase] of Object.entries(TABLE) as [
    keyof AgentControls,
    Readonly<Record<AgentPhase, boolean>>,
  ][]) {
    for (const [phase, enabled] of Object.entries(byPhase) as [AgentPhase, boolean][]) {
      it(`${control}_is${enabled ? 'Enabled' : 'Disabled'}_when${phase[0].toUpperCase()}${phase.slice(1)}`, () => {
        expect(agentControls(phase)[control]).toBe(enabled);
      });
    }
  }

  it('onlyStopCanActOnARunInFlight', () => {
    // The shape of the table in one line: while a run is in flight, Stop and Remote Control are the
    // only things left standing — everything else would be a promise the running turn cannot keep.
    for (const phase of ['working', 'waiting'] as const) {
      const controls: AgentControls = agentControls(phase);
      expect(
        (Object.keys(controls) as (keyof AgentControls)[]).filter(
          (key: keyof AgentControls): boolean => controls[key],
        ),
      ).toEqual(['stop', 'remoteControl']);
    }
  });
});

describe('agentPhase', () => {
  it('isEmpty_untilThereIsATranscript', () => {
    expect(agentPhase(false, false, false)).toBe('empty');
  });

  it('isIdle_withATranscriptAndNoRun', () => {
    expect(agentPhase(true, false, false)).toBe('idle');
  });

  it('isWorking_whileARunIsInFlight', () => {
    expect(agentPhase(true, true, false)).toBe('working');
  });

  it('isWaiting_whileTheRunIsBlockedOnTheUser', () => {
    expect(agentPhase(true, true, true)).toBe('waiting');
  });

  it('aRunOnAnEmptyTranscript_isWorking_notEmpty', () => {
    // The first message is in flight and its user row is the transcript; but even if a surface
    // reports no messages yet, a run in flight is the fact that matters for the controls.
    expect(agentPhase(false, true, false)).toBe('working');
  });

  it('aStaleDecisionWithNoRun_isNotWaiting', () => {
    // A pending prompt only means "waiting" while a run is actually blocked on it.
    expect(agentPhase(true, false, true)).toBe('idle');
  });
});
