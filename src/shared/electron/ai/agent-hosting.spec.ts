import { describe, expect, it, type Mock, vi } from 'vitest';
import type { AiPermissionPosture, AiToolPolicy } from '@shared/api/ai-types';
import type { HostedRepositoryRef, HostingResponse } from '@shared/api/hosting-protocol';
import type { HostingAgentAccess, RunHosting } from '../hosting/hosting-agent-access';
import type { HostingCaller } from '../hosting/hosting-write-gate';
import type { AuditGrantSource } from './agent-audit-log';
import { bindAgentHosting } from './agent-hosting';
import type { AgentHosting } from './agent-provider';

const REPOSITORY: HostedRepositoryRef = { host: 'github.com', owner: 'onix-labs', name: 'studio' };

const RUN: RunHosting = {
  pluginId: 'onixlabs.github',
  provider: 'GitHub',
  repository: REPOSITORY,
  capabilities: ['issues', 'createIssue'],
  commandLineTools: ['gh'],
};

/**
 * Binds the run over a fake access that answers every request the same way and records the caller.
 * @param answer The answer every request gets.
 * @param posture The run's posture.
 * @param policies The run's per-tool policies.
 * @returns Returns the bound hosting and the spies.
 */
function bind(
  answer: HostingResponse,
  posture: AiPermissionPosture = 'prompt',
  policies: Readonly<Record<string, AiToolPolicy>> = {},
): {
  hosting: AgentHosting;
  callers: HostingCaller[];
  ask: Mock<(tool: string, summary: string) => Promise<boolean>>;
  audit: Mock<(tool: string, detail: string, source: AuditGrantSource) => void>;
} {
  const callers: HostingCaller[] = [];
  const access: Partial<HostingAgentAccess> = {
    request: (_run: RunHosting, _op: unknown, _params: unknown, caller: HostingCaller) => {
      callers.push(caller);
      return Promise.resolve(answer);
    },
  };
  const ask: Mock<(tool: string, summary: string) => Promise<boolean>> = vi
    .fn<(tool: string, summary: string) => Promise<boolean>>()
    .mockResolvedValue(true);
  const audit: Mock<(tool: string, detail: string, source: AuditGrantSource) => void> =
    vi.fn<(tool: string, detail: string, source: AuditGrantSource) => void>();
  return {
    hosting: bindAgentHosting(access as HostingAgentAccess, RUN, {
      permissionPosture: posture,
      toolPolicies: policies,
      ask,
      audit,
    }),
    callers,
    ask,
    audit,
  };
}

describe('bindAgentHosting', () => {
  it('carriesTheRunsRepository_andCapabilities', () => {
    const { hosting } = bind({ id: 1, ok: true, result: [] });

    expect(hosting.repository).toEqual(REPOSITORY);
    expect(hosting.capabilities).toEqual(['issues', 'createIssue']);
  });

  it('sendsAsTheAgent_withThePostureAndPolicies_askingUnderTheToolsOwnName', async () => {
    const { hosting, callers, ask } = bind({ id: 1, ok: true, result: {} }, 'prompt', {
      hosting_create_issue: 'ask',
    });

    await hosting.request('createIssue', { repository: REPOSITORY, title: 'Fix login' });
    const caller: HostingCaller = callers[0];
    expect(caller).toMatchObject({
      kind: 'agent',
      posture: 'prompt',
      policies: { hosting_create_issue: 'ask' },
    });
    // The write gate's confirmation is the run's own prompt, under the offered tool's name — which
    // is what lets a remembered "always allow" for the tool apply.
    if (caller.kind === 'agent') {
      await caller.confirm('GitHub: open an issue “Fix login” in onix-labs/studio');
    }
    expect(ask).toHaveBeenCalledWith(
      'hosting_create_issue',
      'GitHub: open an issue “Fix login” in onix-labs/studio',
    );
  });

  it('auditsAWriteThatWentThrough_inTheUsersTerms', async () => {
    const { hosting, audit } = bind({ id: 1, ok: true, result: {} }, 'auto-all');

    await hosting.request('createIssue', { repository: REPOSITORY, title: 'Fix login' });

    expect(audit).toHaveBeenCalledWith(
      'hosting_create_issue',
      'GitHub: open an issue “Fix login” in onix-labs/studio',
      'posture',
    );
  });

  it('auditsNeitherAReadNorAWriteThatWasRefused', async () => {
    const read: ReturnType<typeof bind> = bind({ id: 1, ok: true, result: [] });
    await read.hosting.request('listIssues', { repository: REPOSITORY });
    const refused: ReturnType<typeof bind> = bind({
      id: 1,
      ok: false,
      error: 'The write was declined.',
      code: 'refused',
    });
    await refused.hosting.request('createIssue', { repository: REPOSITORY, title: 'x' });

    expect(read.audit).not.toHaveBeenCalled();
    expect(refused.audit).not.toHaveBeenCalled();
  });
});
