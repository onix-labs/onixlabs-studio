import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DELETE_MODEL,
  DOWNLOAD_MODEL,
  LIST_SKILL_TAGS,
  SAVE_PERSONA_ENTRY,
  SAVE_SKILL,
  type AiBridgeScope,
} from '@shared/api/ai-types';
import type { Skill, SkillDraft, SkillSaveResult } from '@shared/api/skill-channels';
import { AiManagerNavigation } from '@shared/angular/services/ai-manager-navigation/ai-manager-navigation';
import { AiCapability, AiRuntime } from '@shared/angular/services/ai-runtime/ai-runtime';
import { Log } from '@shared/angular/services/log/log';
import { Persona, PersonaEntry } from '@shared/angular/services/persona/persona';
import { Skills } from '@shared/angular/services/skills/skills';
import { ModelConnections } from '../model-connections/model-connections';
import { ModelManagerCommands } from '../model-manager-commands/model-manager-commands';
import { ModelRuntimes } from '../model-runtime/model-runtimes';
import { AiManagerAgentCapabilities } from './ai-manager-agent-capabilities';

const MODELS: AiBridgeScope = { owningTabId: 'tab', surface: 'models', workspaceRoot: null };
const MONITOR: AiBridgeScope = { owningTabId: 'tab', surface: 'monitor', workspaceRoot: null };

/**
 * Builds a stored skill.
 * @param name The name.
 * @returns Returns the skill.
 */
function skill(name: string): Skill {
  return {
    name,
    description: 'House style.',
    scope: { surfaces: ['editor'], languages: ['csharp'] },
    technologies: ['ef-core'],
    enabled: true,
    body: 'Prefer explicit types.',
    directory: `/lib/${name}`,
    files: [],
    problem: null,
  };
}

describe('AiManagerAgentCapabilities', () => {
  let capabilities: Map<string, AiCapability>;
  let saved: SkillDraft[];
  let shown: string[];
  let pull: ReturnType<typeof vi.fn>;
  let linked: string[];
  let unlinked: string[];
  let refreshed: number;
  let removable: boolean;

  beforeEach(() => {
    capabilities = new Map<string, AiCapability>();
    saved = [];
    shown = [];
    linked = [];
    unlinked = [];
    refreshed = 0;
    removable = true;
    pull = vi.fn((): Promise<boolean> => Promise.resolve(true));
    TestBed.configureTestingModule({
      providers: [
        AiManagerAgentCapabilities,
        {
          provide: AiRuntime,
          useValue: {
            registerCapability: (name: string, handler: AiCapability): (() => void) => {
              capabilities.set(name, handler);
              return (): void => void capabilities.delete(name);
            },
          },
        },
        {
          provide: ModelRuntimes,
          useValue: {
            status: (): Promise<{ available: boolean }> => Promise.resolve({ available: true }),
            pull,
            remove: (): Promise<boolean> => Promise.resolve(removable),
          },
        },
        {
          provide: ModelConnections,
          useValue: {
            linkInstalled: (name: string): Promise<void> => {
              linked.push(name);
              return Promise.resolve();
            },
            unlinkRemoved: (name: string): number => unlinked.push(name),
          },
        },
        { provide: ModelManagerCommands, useValue: { refresh: (): number => (refreshed += 1) } },
        {
          provide: Skills,
          useValue: {
            skills: signal<readonly Skill[]>([skill('csharp-style')]),
            save: (draft: SkillDraft): Promise<SkillSaveResult> => {
              saved.push(draft);
              return Promise.resolve({ skill: skill(draft.name), error: null });
            },
          },
        },
        {
          provide: AiManagerNavigation,
          useValue: { show: (section: string): number => shown.push(section) },
        },
        { provide: Log, useValue: { info: (): void => undefined } },
      ],
    });
    TestBed.inject(AiManagerAgentCapabilities);
  });

  /**
   * Calls a registered capability.
   * @param name The capability.
   * @param input What the model sent.
   * @param scope The run's scope.
   * @returns Returns the answer.
   */
  function call(name: string, input: unknown, scope: AiBridgeScope = MODELS): Promise<unknown> {
    return Promise.resolve(capabilities.get(name)!(input, scope));
  }

  it('answersOnlyTheAiManagersOwnAgent', async () => {
    expect(await call(SAVE_SKILL, { name: 'x' }, MONITOR)).toEqual({ available: false });
    expect(saved).toEqual([]);
  });

  it('saveSkill_refusesATagTheEditorDoesNotOffer', async () => {
    const answer: unknown = await call(SAVE_SKILL, { name: 'new-one', tags: ['angular', 'bogus'] });

    expect(answer).toEqual({
      available: true,
      error: 'These are not tags a skill can have: bogus. Use ids from list_skill_tags.',
    });
    expect(saved).toEqual([]);
  });

  it('saveSkill_changesOnlyWhatItNames_andShowsTheLibrary', async () => {
    await call(SAVE_SKILL, { name: 'csharp-style', tags: ['typescript', 'angular'] });

    expect(saved[0]).toEqual({
      name: 'csharp-style',
      description: 'House style.',
      scope: { surfaces: ['editor'], languages: ['typescript'] },
      technologies: ['angular'],
      enabled: true,
      body: 'Prefer explicit types.',
    });
    expect(shown).toEqual(['skills']);
  });

  it('saveSkill_renamesWhenGivenThePreviousName', async () => {
    await call(SAVE_SKILL, { name: 'Dotnet-Style', previous_name: 'csharp-style' });

    expect(saved[0]).toMatchObject({ name: 'dotnet-style', previousName: 'csharp-style' });
  });

  it('savePersonaEntry_createsAMemory_orChangesOneByItsId_andRefusesAnUnknownId', async () => {
    const entries: () => readonly PersonaEntry[] = TestBed.inject(Persona).entries;
    expect(
      await call(SAVE_PERSONA_ENTRY, {
        name: 'Terse',
        text: 'Be brief.',
        tags: ['Preferences'],
        languages: ['TS'],
      }),
    ).toEqual({ available: true, created: true, id: 'terse', name: 'Terse' });
    expect(entries()[0]).toMatchObject({
      text: 'Be brief.',
      layer: 'memory',
      tags: ['preferences'],
      author: 'user',
      locked: true,
      scope: { surfaces: [], languages: ['ts'] },
    });

    await call(SAVE_PERSONA_ENTRY, { id: 'terse', enabled: false, layer: 'core' });
    expect(entries()[0]).toMatchObject({ name: 'Terse', enabled: false, layer: 'core' });

    expect(await call(SAVE_PERSONA_ENTRY, { id: 'nope' })).toMatchObject({
      error: expect.stringContaining('no persona entry') as unknown,
    });
    expect(shown).toEqual(['persona', 'persona']);
  });

  it('download_startsThePull_andLinksTheModelWhenItFinishes', async () => {
    expect(await call(DOWNLOAD_MODEL, { ref: 'qwen3:8b' })).toEqual({
      available: true,
      started: true,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(pull).toHaveBeenCalledWith('qwen3:8b');
    expect(linked).toEqual(['qwen3:8b']);
    expect(refreshed).toBe(1);
    expect(shown).toEqual(['models']);
  });

  it('deleteModel_unlinksIt_orSaysWhyNot', async () => {
    expect(await call(DELETE_MODEL, { name: 'qwen3:8b' })).toEqual({
      available: true,
      deleted: true,
    });
    expect(unlinked).toEqual(['qwen3:8b']);

    removable = false;
    expect(await call(DELETE_MODEL, { name: 'gone' })).toMatchObject({
      error: expect.stringContaining('could not be deleted') as unknown,
    });
  });

  it('listTags_groupsTheIdsByCategory', async () => {
    const answer: { result: { tags: Record<string, { id: string }[]> } } = (await call(
      LIST_SKILL_TAGS,
      {},
    )) as { result: { tags: Record<string, { id: string }[]> } };

    expect(
      answer.result.tags['Languages'].some((tag: { id: string }) => tag.id === 'typescript'),
    ).toBe(true);
    expect(answer.result.tags['Frontend'].some((tag: { id: string }) => tag.id === 'angular')).toBe(
      true,
    );
  });
});
