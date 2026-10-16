import { describe, expect, it } from 'vitest';
import {
  auditSource,
  decideCommand,
  decideFileChange,
  decidePermissions,
  policyFor,
  withholdsBuiltInTools,
} from './policy';
import type { TurnRequest } from './protocol';

/**
 * Builds a turn, as Studio sends one, with overrides.
 * @param overrides The fields to change.
 * @returns Returns the turn.
 */
function turn(overrides: Partial<TurnRequest> = {}): TurnRequest {
  return {
    requestId: 'run-1',
    prompt: 'hello',
    workspaceRoot: '/ws',
    model: 'gpt-5.6-terra',
    agentSessionId: 'agent-1',
    effort: null,
    mode: 'agent',
    surface: 'workspace',
    allowedWritePaths: [],
    deniedWritePaths: [],
    allowedNetworkLocations: [],
    deniedNetworkLocations: [],
    tokenCap: 0,
    resumeSessionId: null,
    forkSession: false,
    resumeSessionAt: null,
    permissionPosture: 'prompt',
    toolPolicies: {},
    images: [],
    contextPaths: [],
    remoteControl: 'off',
    agentShell: null,
    owningTabId: null,
    providerSettings: {},
    ...overrides,
  };
}

describe('policyFor', () => {
  it('anAgentTurn_writesInsideTheWorkspaceAndAllowedPaths_andAsksBeforeEverythingElse', () => {
    expect(policyFor(turn({ allowedWritePaths: ['/extra'] }))).toEqual({
      sandbox: 'workspace-write',
      writableRoots: ['/ws', '/extra'],
      networkAccess: true,
      approvalPolicy: 'untrusted',
      webSearch: 'default',
    });
  });

  it('autoAll_runsInsideTheSandboxWithoutAsking', () => {
    expect(policyFor(turn({ permissionPosture: 'auto-all' })).approvalPolicy).toBe('never');
    expect(policyFor(turn({ permissionPosture: 'auto-edits' })).approvalPolicy).toBe('untrusted');
  });

  it('aChatTurn_isReadOnly', () => {
    expect(policyFor(turn({ mode: 'chat' }))).toMatchObject({
      sandbox: 'read-only',
      writableRoots: [],
      approvalPolicy: 'untrusted',
      webSearch: 'disabled',
    });
  });

  it('aConfinedTurn_isReadOnlyAndOffTheNetwork', () => {
    // #965: a tool view's agent, or a terminal's. Codex cannot drop its shell, so the shell is left
    // with nothing it can take anywhere.
    for (const confined of [
      turn({ builtInTools: 'none', surface: 'containers' }),
      turn({ surface: 'terminal' }),
    ]) {
      expect(withholdsBuiltInTools(confined)).toBe(true);
      expect(policyFor(confined)).toEqual({
        sandbox: 'read-only',
        writableRoots: [],
        networkAccess: false,
        approvalPolicy: 'untrusted',
        webSearch: 'disabled',
      });
    }
    expect(withholdsBuiltInTools(turn())).toBe(false);
  });

  it('anAllowListOfHosts_failsClosed_sinceCodexHasOneNetworkSwitch', () => {
    expect(policyFor(turn({ allowedNetworkLocations: ['api.example'] })).networkAccess).toBe(false);
    expect(policyFor(turn({ deniedNetworkLocations: ['evil.example'] })).networkAccess).toBe(true);
  });

  it('aDeniedWebSearch_switchesTheToolOff', () => {
    expect(policyFor(turn({ toolPolicies: { WebSearch: 'deny' } })).webSearch).toBe('disabled');
  });

  it('noWorkspace_leavesNoRootsToName', () => {
    expect(policyFor(turn({ workspaceRoot: null })).writableRoots).toEqual([]);
  });
});

describe('decideCommand', () => {
  it('asksUnderThePromptPosture', () => {
    expect(decideCommand(turn())).toEqual({ kind: 'ask', tool: 'Bash' });
    expect(decideCommand(turn({ permissionPosture: 'auto-edits' }))).toEqual({
      kind: 'ask',
      tool: 'Bash',
    });
  });

  it('followsThePerToolPolicy_beforeThePosture', () => {
    expect(decideCommand(turn({ toolPolicies: { Bash: 'allow' } }))).toEqual({
      kind: 'accept',
      source: 'policy',
    });
    expect(
      decideCommand(turn({ toolPolicies: { Bash: 'deny' }, permissionPosture: 'auto-all' })),
    ).toMatchObject({ kind: 'decline' });
    expect(decideCommand(turn({ permissionPosture: 'auto-all' }))).toEqual({
      kind: 'accept',
      source: 'posture',
    });
  });

  it('refusesOutright_whenTheTurnMayNotAct', () => {
    expect(decideCommand(turn({ mode: 'chat' }))).toMatchObject({ kind: 'decline' });
    expect(decideCommand(turn({ surface: 'terminal', toolPolicies: { Bash: 'allow' } }))).toEqual({
      kind: 'decline',
      reason: 'This agent can only use the terminal.',
    });
    expect(
      decideCommand(
        turn({ builtInTools: 'none', surface: 'plugins', permissionPosture: 'auto-all' }),
      ),
    ).toMatchObject({ kind: 'decline' });
  });
});

describe('decideFileChange', () => {
  it('asksUnderThePromptPosture_andAcceptsUnderAutoEdits', () => {
    expect(decideFileChange(turn())).toEqual({ kind: 'ask', tool: 'Edit' });
    expect(decideFileChange(turn({ permissionPosture: 'auto-edits' }))).toEqual({
      kind: 'accept',
      source: 'posture',
    });
    expect(decideFileChange(turn({ permissionPosture: 'auto-all' }))).toEqual({
      kind: 'accept',
      source: 'posture',
    });
  });

  it('aDenyOnAnyFileTool_refuses_andAnAllowOnAllOfThem_accepts', () => {
    expect(
      decideFileChange(
        turn({ toolPolicies: { Write: 'allow', Edit: 'allow', MultiEdit: 'deny' } }),
      ),
    ).toEqual({
      kind: 'decline',
      reason: 'Blocked: the MultiEdit tool is set to Deny in your agent settings.',
    });
    expect(decideFileChange(turn({ toolPolicies: { Write: 'allow', Edit: 'allow' } }))).toEqual({
      kind: 'ask',
      tool: 'Edit',
    });
    expect(
      decideFileChange(
        turn({ toolPolicies: { Write: 'allow', Edit: 'allow', MultiEdit: 'allow' } }),
      ),
    ).toEqual({ kind: 'accept', source: 'policy' });
  });

  it('refusesOutright_whenTheTurnMayNotAct', () => {
    expect(decideFileChange(turn({ mode: 'chat', permissionPosture: 'auto-all' }))).toMatchObject({
      kind: 'decline',
    });
  });
});

describe('decidePermissions and auditSource', () => {
  it('neverWidensTheWriteArea', () => {
    expect(decidePermissions()).toMatchObject({ kind: 'decline' });
  });

  it('namesWhyAnActionWasAllowed', () => {
    expect(auditSource({ kind: 'accept', source: 'policy' })).toBe('policy');
    expect(auditSource({ kind: 'accept', source: 'posture' })).toBe('posture');
    expect(auditSource({ kind: 'ask', tool: 'Bash' })).toBe('gated-or-auto');
  });
});
