import { TestBed } from '@angular/core/testing';
import { Bridge } from '@shared/api/bridge';
import { Skill, SkillChannel, SkillSaveResult } from '@shared/api/skill-channels';
import { Skills } from './skills';

/**
 * A recorded bridge invocation.
 */
interface InvokeCall {
  readonly channel: string;
  readonly args: readonly unknown[];
}

/**
 * Builds a stored skill.
 * @param name The name.
 * @returns Returns the skill.
 */
function skill(name: string): Skill {
  return {
    name,
    description: 'd',
    scope: { surfaces: [], languages: [] },
    enabled: true,
    body: 'b',
    directory: `/lib/${name}`,
    files: [],
    problem: null,
  };
}

describe('Skills', () => {
  let calls: InvokeCall[];
  let listResult: readonly Skill[];
  let saveResult: SkillSaveResult;

  /**
   * Installs a stub bridge that records invocations.
   */
  function stubBridge(): void {
    calls = [];
    const bridge: Bridge = {
      invoke: <T>(channel: string, ...args: unknown[]): Promise<T> => {
        calls.push({ channel, args });
        if (channel === (SkillChannel.List as string)) {
          return Promise.resolve(listResult as T);
        }
        if (
          channel === (SkillChannel.Save as string) ||
          channel === (SkillChannel.Import as string)
        ) {
          return Promise.resolve(saveResult as T);
        }
        return Promise.resolve(undefined as T);
      },
      send: (): void => undefined,
      on: (): (() => void) => (): void => undefined,
    };
    (window as unknown as { bridge: Bridge }).bridge = bridge;
  }

  beforeEach(() => {
    listResult = [skill('a')];
    saveResult = { skill: skill('a'), error: null };
    stubBridge();
  });

  afterEach(() => {
    delete (window as unknown as { bridge?: Bridge }).bridge;
  });

  it('constructor_readsTheLibraryOnce', async () => {
    const skills: Skills = TestBed.inject(Skills);
    await Promise.resolve();
    await Promise.resolve();

    expect(skills.skills().map((entry: Skill): string => entry.name)).toEqual(['a']);
    expect(calls.filter((call: InvokeCall): boolean => call.channel === 'skill:list')).toHaveLength(
      1,
    );
  });

  it('save_sendsTheDraftAndReReadsTheLibrary', async () => {
    const skills: Skills = TestBed.inject(Skills);
    listResult = [skill('a'), skill('b')];

    const result: SkillSaveResult = await skills.save({
      name: 'b',
      description: 'd',
      scope: { surfaces: [], languages: [] },
      enabled: true,
      body: 'b',
    });

    expect(result.error).toBeNull();
    expect(calls.some((call: InvokeCall): boolean => call.channel === 'skill:save')).toBe(true);
    expect(skills.skills()).toHaveLength(2);
  });

  it('delete_sendsTheNameAndReReadsTheLibrary', async () => {
    const skills: Skills = TestBed.inject(Skills);
    listResult = [];

    await skills.delete('a');

    expect(
      calls.find((call: InvokeCall): boolean => call.channel === 'skill:delete')?.args,
    ).toEqual(['a']);
    expect(skills.skills()).toEqual([]);
  });

  it('import_whenCancelled_returnsNullWithoutReReading', async () => {
    const skills: Skills = TestBed.inject(Skills);
    await Promise.resolve();
    const before: number = calls.filter(
      (call: InvokeCall): boolean => call.channel === 'skill:list',
    ).length;
    saveResult = null as unknown as SkillSaveResult;

    expect(await skills.import()).toBeNull();
    expect(calls.filter((call: InvokeCall): boolean => call.channel === 'skill:list')).toHaveLength(
      before,
    );
  });

  it('save_whenNoBridge_reportsTheDesktopOnlyLibrary', async () => {
    delete (window as unknown as { bridge?: Bridge }).bridge;
    const skills: Skills = TestBed.inject(Skills);

    const result: SkillSaveResult = await skills.save({
      name: 'x',
      description: 'd',
      scope: { surfaces: [], languages: [] },
      enabled: true,
      body: '',
    });

    expect(result.skill).toBeNull();
    expect(result.error).toContain('desktop');
  });
});
