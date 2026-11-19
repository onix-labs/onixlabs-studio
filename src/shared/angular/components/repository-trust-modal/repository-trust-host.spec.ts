import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { AiProviderInfo } from '@shared/api/ai-types';
import { AgentEngine } from '@shared/angular/services/agent-engine/agent-engine';
import { RepositoryTrust } from '@shared/angular/services/repository-trust/repository-trust';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { RepositoryTrustHost } from './repository-trust-host';

/**
 * Builds a provider.
 * @param ignoresUntrustedSettings What its plugin said it can do, or undefined when unknown.
 * @returns Returns the provider.
 */
function provider(ignoresUntrustedSettings?: boolean): AiProviderInfo {
  return {
    id: 'claude',
    label: 'Anthropic (Claude)',
    available: true,
    detail: '',
    models: [],
    defaultModelId: 'opus',
    ...(ignoresUntrustedSettings === undefined ? {} : { ignoresUntrustedSettings }),
  };
}

describe('RepositoryTrustHost (#1504)', () => {
  let answers: string[];
  let opened: string[];

  /**
   * Mounts the host over a provider.
   * @param info The active provider.
   * @returns Returns the fixture.
   */
  function mount(info: AiProviderInfo): ComponentFixture<RepositoryTrustHost> {
    answers = [];
    opened = [];
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AgentEngine,
          useValue: { provider: signal<string>('claude'), providers: signal([info]) },
        },
        {
          provide: RepositoryTrust,
          useValue: {
            pending: signal(null),
            answer: (answer: string): number => answers.push(answer),
          },
        },
        { provide: Tabs, useValue: { open: (type: string): number => opened.push(type) } },
      ],
    });
    return TestBed.createComponent(RepositoryTrustHost);
  }

  it('blocksTheScan_onlyWhenThePluginHasSaidItCannotBeKeptFromTheFolder', () => {
    const blocked: { scanBlockedBy(): string | null } = mount(provider(false))
      .componentInstance as never;
    expect(blocked.scanBlockedBy()).toBe('Anthropic (Claude)');

    TestBed.resetTestingModule();
    const unknown: { scanBlockedBy(): string | null } = mount(provider())
      .componentInstance as never;
    expect(unknown.scanBlockedBy()).toBeNull();
  });

  it('update_leavesTheFolderUntrusted_andOpensThePluginManager', () => {
    const host: { updatePlugin(): void } = mount(provider(false)).componentInstance as never;

    host.updatePlugin();

    expect(answers).toEqual(['restricted']);
    expect(opened).toEqual(['plugin-manager']);
  });
});
