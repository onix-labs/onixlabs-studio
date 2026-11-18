import { homedir } from 'node:os';
import * as path from 'node:path';
import type { RepositoryTrustDecision } from '@shared/api/source-control-channels';
import type { TrustAnswer, TrustChange, TrustQuestion } from '@shared/api/trust-channels';
import type { RepositoryTrustChoice } from '../repository-trust';
import { TrustManager, TrustStore } from './trust-manager';
import type { TrustAsker } from './trust-prompt';

/**
 * An open workspace root every test works with.
 */
const ROOT: string = path.resolve('/work/shop');

/**
 * A trust store held in memory, deciding exactly as the real one: the nearest decision wins.
 */
class MemoryStore implements TrustStore {
  /**
   * Holds the decisions.
   */
  public readonly decisions: Map<string, RepositoryTrustChoice> = new Map<
    string,
    RepositoryTrustChoice
  >();

  /**
   * Gets the nearest decision on a folder or an ancestor.
   * @param target The folder.
   * @returns Returns the decision.
   */
  public decisionFor(target: unknown): RepositoryTrustDecision {
    let candidate: string = path.resolve(String(target));
    for (;;) {
      const found: RepositoryTrustChoice | undefined = this.decisions.get(candidate);
      if (found !== undefined) {
        return found;
      }
      const parent: string = path.dirname(candidate);
      if (parent === candidate) {
        return 'unknown';
      }
      candidate = parent;
    }
  }

  /**
   * Records a decision.
   * @param target The folder.
   * @param choice The decision.
   */
  public decide(target: string, choice: RepositoryTrustChoice): void {
    this.decisions.set(path.resolve(target), choice);
  }
}

describe('TrustManager (#1504)', () => {
  let store: MemoryStore;
  let asked: TrustQuestion[];
  let answers: TrustAnswer[];
  let changes: TrustChange[];
  let manager: TrustManager;

  beforeEach(() => {
    store = new MemoryStore();
    asked = [];
    answers = ['trusted'];
    changes = [];
    const asker: TrustAsker = {
      ask: (question: TrustQuestion): Promise<TrustAnswer> => {
        asked.push(question);
        return Promise.resolve(answers.shift() ?? 'restricted');
      },
    };
    manager = new TrustManager(
      store,
      { openRoots: (): readonly string[] => [ROOT] },
      asker,
      (change: TrustChange): void => void changes.push(change),
    );
  });

  it('ask_putsTheQuestion_recordsTheAnswer_andTellsEveryWindow', async () => {
    expect(await manager.ask(ROOT)).toBe('trusted');

    expect(asked).toEqual([{ name: 'shop', folder: ROOT }]);
    expect(store.decisionFor(ROOT)).toBe('trusted');
    expect(changes).toEqual([{ folder: ROOT, decision: 'trusted' }]);
  });

  it('ask_aboutATrustedFolder_asksNothing', async () => {
    store.decide(ROOT, 'trusted');

    expect(await manager.ask(path.join(ROOT, 'src'))).toBe('trusted');

    expect(asked).toEqual([]);
  });

  it('ask_aboutARestrictedFolder_asksAgain_soTheUserCanChangeTheirMind', async () => {
    store.decide(ROOT, 'restricted');

    expect(await manager.ask(ROOT)).toBe('trusted');

    expect(asked).toHaveLength(1);
  });

  it('ask_whenTheUserSaysNo_recordsRestricted', async () => {
    answers = ['restricted'];

    expect(await manager.ask(ROOT)).toBe('restricted');

    expect(store.decisionFor(ROOT)).toBe('restricted');
  });

  it('ask_twiceForOneFolder_putsTheQuestionOnce', async () => {
    const [first, second]: RepositoryTrustDecision[] = await Promise.all([
      manager.ask(ROOT),
      manager.ask(ROOT),
    ]);

    expect([first, second]).toEqual(['trusted', 'trusted']);
    expect(asked).toHaveLength(1);
  });

  it('ask_aboutTheRepositoryAnOpenRootLiesIn_isAllowed', async () => {
    const repository: string = path.dirname(ROOT);

    expect(await manager.ask(repository)).toBe('trusted');

    expect(asked[0].folder).toBe(repository);
  });

  it.each([
    ['aFolderStudioDoesNotHaveOpen', path.resolve('/elsewhere')],
    ['aRelativePath', 'shop'],
    ['aNonString', 7],
    ['theDiskItself', path.parse(ROOT).root],
  ])('ask_about_%s_isRefusedUnasked', async (_name: string, folder: unknown) => {
    expect(await manager.ask(folder)).toBe('unknown');

    expect(asked).toEqual([]);
    expect(store.decisions.size).toBe(0);
  });

  it('ask_aboutTheHomeFolder_isRefused_evenWithAWorkspaceInIt', async () => {
    const home: string = path.resolve(homedir());
    const insideHome: TrustManager = new TrustManager(
      store,
      { openRoots: (): readonly string[] => [path.join(home, 'Code', 'shop')] },
      { ask: (): Promise<TrustAnswer> => Promise.resolve('trusted') },
      (): void => undefined,
    );

    expect(await insideHome.ask(home)).toBe('unknown');
    expect(store.decisions.size).toBe(0);
  });

  it('restrict_recordsWithoutAQuestion', () => {
    store.decide(ROOT, 'trusted');

    expect(manager.restrict(ROOT)).toBe('restricted');

    expect(asked).toEqual([]);
    expect(changes).toEqual([{ folder: ROOT, decision: 'restricted' }]);
  });

  it('state_readsTheDecision_andAnswersUnknownOutsideTheWorkspace', () => {
    store.decide(ROOT, 'trusted');

    expect(manager.state(ROOT)).toBe('trusted');
    expect(manager.state(path.resolve('/elsewhere'))).toBe('unknown');
  });

  it('aPromptThatFails_recordsNothing', async () => {
    const failing: TrustManager = new TrustManager(
      store,
      { openRoots: (): readonly string[] => [ROOT] },
      { ask: (): Promise<TrustAnswer> => Promise.reject(new Error('no window')) },
      (): void => undefined,
    );

    expect(await failing.ask(ROOT)).toBe('unknown');
    expect(store.decisions.size).toBe(0);
  });
});
