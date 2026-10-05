import { describe, expect, it } from 'vitest';
import {
  hostingAgentToolName,
  hostingOpToolName,
  hostingWriteDecision,
} from './hosting-write-gate';

describe('hostingWriteDecision', () => {
  it('asks_underPrompt', () => {
    expect(hostingWriteDecision('hosting:rerunCiRun', 'prompt', {})).toBe('ask');
  });

  it('asks_underAutoEdits_becauseAWriteToAHostIsNotAFileEdit', () => {
    expect(hostingWriteDecision('hosting:rerunCiRun', 'auto-edits', {})).toBe('ask');
  });

  it('allows_underAutoAll', () => {
    expect(hostingWriteDecision('hosting:rerunCiRun', 'auto-all', {})).toBe('allow');
  });

  it('letsAnExplicitPolicyWin_overThePosture', () => {
    expect(
      hostingWriteDecision('hosting:rerunCiRun', 'auto-all', { 'hosting:rerunCiRun': 'deny' }),
    ).toBe('deny');
    expect(
      hostingWriteDecision('hosting:rerunCiRun', 'prompt', { 'hosting:rerunCiRun': 'allow' }),
    ).toBe('allow');
  });

  it('ignoresAPolicyForAnotherTool', () => {
    expect(
      hostingWriteDecision('hosting:cancelCiRun', 'prompt', { 'hosting:rerunCiRun': 'allow' }),
    ).toBe('ask');
  });
});

describe('tool names', () => {
  it('namesATypedWrite_andAPluginsToolSoTwoPluginsToolsAreToldApart', () => {
    expect(hostingOpToolName('rerunCiRun')).toBe('hosting:rerunCiRun');
    expect(hostingAgentToolName('onixlabs.github', 'create_release')).toBe(
      'hosting:onixlabs.github/create_release',
    );
    expect(hostingAgentToolName('acme.gitlab', 'create_release')).not.toBe(
      hostingAgentToolName('onixlabs.github', 'create_release'),
    );
  });
});
