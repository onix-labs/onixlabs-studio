import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { AiConnection, AiProviderInfo } from '@shared/api/ai-types';
import type { DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { AgentEngine } from '@shared/angular/services/agent-engine/agent-engine';
import { Settings } from '@shared/angular/services/settings/settings';
import { PersonaLearningConnection } from './persona-learning-connection';

describe('PersonaLearningConnection (#1516)', () => {
  let fixture: ComponentFixture<PersonaLearningConnection>;
  let settings: Settings;
  let providers: WritableSignal<readonly AiProviderInfo[]>;

  beforeEach(async () => {
    localStorage.clear();
    providers = signal<readonly AiProviderInfo[]>([
      {
        id: 'local',
        label: 'Ollama',
        available: true,
        detail: '',
        defaultModelId: 'qwen3:8b',
        models: [
          { id: 'qwen3:8b', label: 'Qwen3 8B' },
          { id: 'qwen3:4b', label: 'Qwen3 4B' },
        ],
      },
      {
        id: 'claude',
        label: 'Claude',
        available: true,
        detail: '',
        defaultModelId: 'sonnet',
        models: [{ id: 'sonnet', label: 'Sonnet' }],
      },
    ]);
    TestBed.configureTestingModule({
      providers: [{ provide: AgentEngine, useValue: { providers } }],
    });
    settings = TestBed.inject(Settings);
    settings.set('ai.connections', [
      { id: 'local', kind: 'ollama', label: 'Ollama' } as AiConnection,
      { id: 'claude', kind: 'anthropic', label: 'Claude' } as AiConnection,
    ]);
    fixture = TestBed.createComponent(PersonaLearningConnection);
    await fixture.whenStable();
  });

  /**
   * Gets the model choices offered, as the component computes them.
   * @returns Returns the options.
   */
  function models(): readonly DropdownOption[] {
    const component: { models(): readonly DropdownOption[] } = fixture.componentInstance as never;
    return component.models();
  }

  it('listsTheChosenConnectionsModels_withItsDefaultFirst', async () => {
    settings.set('persona.learningConnectionId', 'local');
    await fixture.whenStable();

    expect(models().map((option: DropdownOption): string => option.label)).toEqual([
      'Connection default (Qwen3 8B)',
      'Qwen3 8B',
      'Qwen3 4B',
    ]);
  });

  it('choosingAnotherConnection_goesBackToItsDefaultModel', async () => {
    settings.set('persona.learningConnectionId', 'local');
    settings.set('persona.learningModel', 'qwen3:4b');
    const component: { choose(id: string): void } = fixture.componentInstance as never;

    component.choose('claude');
    await fixture.whenStable();

    expect(settings.get('persona.learningModel')).toBe('');
    expect(models().map((option: DropdownOption): string => option.label)).toEqual([
      'Connection default (Sonnet)',
      'Sonnet',
    ]);
  });

  it('aModelTheConnectionNoLongerOffers_staysListedButCannotBePicked', async () => {
    settings.set('persona.learningConnectionId', 'local');
    settings.set('persona.learningModel', 'llama2');
    await fixture.whenStable();

    expect(models().at(-1)).toEqual({
      value: 'llama2',
      label: 'llama2 (not offered)',
      disabled: true,
    });
  });
});
