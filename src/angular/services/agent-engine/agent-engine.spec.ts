import { TestBed } from '@angular/core/testing';

import type { AiModelInfo, AiProviderInfo } from '../../../shared/ai-types';
import { AiRuntime } from '../ai-runtime/ai-runtime';
import { Settings } from '../settings/settings';
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
      { id: 'claude-opus-4-8', label: 'Opus 4.8' },
      { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
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

  it('setProvider_whenCalled_persistsToSettings', async () => {
    await engine.loadProviders();
    const settings: Settings = TestBed.inject(Settings);

    engine.setProvider('claude');

    expect(settings.aiProvider()).toBe('claude');
    expect(engine.provider()).toBe('claude');
  });

  it('loadProviders_whenSelectionUnavailable_fallsBackToAnAvailableProvider', async () => {
    const settings: Settings = TestBed.inject(Settings);
    settings.setAiProvider('vercel');

    await engine.loadProviders();

    expect(engine.provider()).toBe('claude');
  });
});
