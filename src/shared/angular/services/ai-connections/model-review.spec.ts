import type { AiModelInfo } from '@shared/api/ai-types';
import { appendModels, ModelReview, modelNames, reviewModels } from './model-review';

/**
 * Builds a model.
 * @param id The model id.
 * @param extra Any flags.
 * @returns Returns the model.
 */
function model(id: string, extra: Partial<AiModelInfo> = {}): AiModelInfo {
  return { id, label: id.toUpperCase(), contextWindow: 1, ...extra };
}

/**
 * Gets the ids of models.
 * @param models The models.
 * @returns Returns their ids.
 */
function ids(models: readonly AiModelInfo[]): readonly string[] {
  return models.map((candidate: AiModelInfo): string => candidate.id);
}

describe('reviewModels', () => {
  it('offersWhatDiscoveryListsAndTheListLacks', () => {
    const review: ModelReview = reviewModels(
      [model('a')],
      { discovered: [model('a'), model('b')], manifest: [] },
      [],
    );

    expect(ids(review.added)).toEqual(['b']);
  });

  it('trustsDiscoveryOverTheManifest_whenDiscoveryAnswered', () => {
    // The manifest is the plugin author's guess at release time; discovery speaks for the account.
    // Offering a manifest model discovery does not list is offering one the account cannot run.
    const review: ModelReview = reviewModels(
      [],
      { discovered: [model('terra')], manifest: [model('sol'), model('terra')] },
      [],
    );

    expect(ids(review.added)).toEqual(['terra']);
  });

  it('readsTheManifest_whenThereIsNoDiscovery', () => {
    const review: ModelReview = reviewModels(
      [model('sol')],
      { discovered: null, manifest: [model('terra'), model('luna')] },
      [],
    );

    expect(ids(review.added)).toEqual(['terra', 'luna']);
  });

  it('skipsModelsTheUserTurnedDown', () => {
    const review: ModelReview = reviewModels(
      [],
      { discovered: [model('terra'), model('luna')], manifest: [] },
      ['luna'],
    );

    expect(ids(review.added)).toEqual(['terra']);
  });

  it('marksRetiredOnlyFromDiscovery_neverRemoving', () => {
    const current: readonly AiModelInfo[] = [model('sol'), model('terra')];

    const discovered: ModelReview = reviewModels(
      current,
      { discovered: [model('terra')], manifest: [] },
      [],
    );
    const manifestOnly: ModelReview = reviewModels(
      current,
      { discovered: null, manifest: [model('terra')] },
      [],
    );

    expect(discovered.models).toEqual([model('sol', { retired: true }), model('terra')]);
    expect(discovered.retired).toEqual(['sol']);
    // A manifest that stops listing a model says nothing about the account.
    expect(manifestOnly.models).toBe(current);
    expect(manifestOnly.retired).toEqual([]);
  });

  it('restoresAModelDiscoveryListsAgain', () => {
    const review: ModelReview = reviewModels(
      [model('sol', { retired: true, pinned: true })],
      { discovered: [model('sol')], manifest: [] },
      [],
    );

    expect(review.models).toEqual([model('sol', { pinned: true })]);
    expect(review.retired).toEqual([]);
  });

  it('neverRetiresAModelAddedByHand', () => {
    const review: ModelReview = reviewModels(
      [model('mine', { manual: true })],
      { discovered: [model('terra')], manifest: [] },
      [],
    );

    expect(review.models).toEqual([model('mine', { manual: true })]);
  });

  it('offersModelsWithoutTheProvidersFlags', () => {
    const review: ModelReview = reviewModels(
      [],
      { discovered: [model('terra', { pinned: true, hidden: true })], manifest: [] },
      [],
    );

    expect(review.added).toEqual([model('terra')]);
  });
});

describe('appendModels', () => {
  it('appendsAfterTheUsersOwn_once', () => {
    expect(ids(appendModels([model('a')], [model('b'), model('a')]))).toEqual(['a', 'b']);
  });
});

describe('modelNames', () => {
  it('namesModelsForASentence', () => {
    expect(modelNames([model('a')])).toBe('A');
    expect(modelNames([model('a'), model('b')])).toBe('A and B');
    expect(modelNames([model('a'), model('b'), model('c')])).toBe('A, B and C');
  });
});
