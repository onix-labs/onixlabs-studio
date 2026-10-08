import { TestBed } from '@angular/core/testing';

import type { AiModelInfo, AiProviderInfo } from '@shared/api/ai-types';
import { AiRuntime } from '../ai-runtime/ai-runtime';
import { Settings } from '@shared/angular/services/settings/settings';
import { AgentEngine } from './agent-engine';

/**
 * The providers the stub runtime reports.
 */
const PROVIDERS: readonly AiProviderInfo[] = [
  {
    id: 'claude',
    label: 'Claude (Agent SDK)',
    available: true,
    detail: 'ok',
    models: [
      { id: 'claude-opus-4-8', label: 'Opus 4.8', contextWindow: 1_000_000 },
      { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', contextWindow: 1_000_000 },
    ],
    defaultModelId: 'claude-opus-4-8',
  },
];

describe('AgentEngine', () => {
  let engine: AgentEngine;

  beforeEach(() => {
    localStorage.clear();
    const runtimeStub: Pick<AiRuntime, 'listProviders'> = {
      listProviders: (): Promise<readonly AiProviderInfo[]> => Promise.resolve(PROVIDERS),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: AiRuntime, useValue: runtimeStub }],
    });
    engine = TestBed.inject(AgentEngine);
  });

  it('whenLoaded_waitsForTheFirstLoad', async () => {
    let settled: boolean = false;
    void engine.whenLoaded.then((): void => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    await engine.loadProviders();
    await Promise.resolve();

    expect(settled).toBe(true);
  });

  it('whenLoaded_resolves_evenWhenTheLoadFails', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AiRuntime,
          useValue: {
            listProviders: (): Promise<readonly AiProviderInfo[]> =>
              Promise.reject(new Error('main is not there')),
          },
        },
      ],
    });
    const failing: AgentEngine = TestBed.inject(AgentEngine);

    await expect(failing.loadProviders()).rejects.toThrow('main is not there');

    await expect(failing.whenLoaded).resolves.toBeUndefined();
  });

  it('model_whenProvidersLoaded_defaultsToTheProviderDefault', async () => {
    await engine.loadProviders();

    expect(engine.models().map((model: AiModelInfo): string => model.id)).toEqual([
      'claude-opus-4-8',
      'claude-sonnet-4-6',
    ]);
    expect(engine.model()).toBe('claude-opus-4-8');
  });

  it('setModel_whenProviderOffersIt_isHonoured', async () => {
    await engine.loadProviders();
    engine.setModel('claude-sonnet-4-6');

    expect(engine.model()).toBe('claude-sonnet-4-6');
  });

  it('setModel_whenProviderDoesNotOfferIt_fallsBackToTheDefault', async () => {
    await engine.loadProviders();
    engine.setModel('made-up-model');

    expect(engine.model()).toBe('claude-opus-4-8');
  });

  it('setProvider_whenCalled_persistsTheActiveConnection', async () => {
    await engine.loadProviders();
    const settings: Settings = TestBed.inject(Settings);

    engine.setProvider('claude');

    expect(settings.aiActiveConnectionId()).toBe('claude');
    expect(engine.provider()).toBe('claude');
  });

  it('loadProviders_whenSelectionUnavailable_fallsBackToAnAvailableConnection', async () => {
    const settings: Settings = TestBed.inject(Settings);
    settings.setActiveConnection('made-up-connection');

    await engine.loadProviders();

    expect(engine.provider()).toBe('claude');
  });
});
