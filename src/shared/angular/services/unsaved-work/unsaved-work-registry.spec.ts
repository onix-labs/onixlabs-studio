import { TestBed } from '@angular/core/testing';

import {
  UNSAVED_WORK,
  UnsavedDocument,
  UnsavedWorkSource,
} from '@shared/angular/services/unsaved-work/unsaved-work';
import { UnsavedWorkRegistry } from './unsaved-work-registry';

/**
 * Creates a distinct no-op unsaved-work source (each call a fresh identity, so ordering and removal
 * can be asserted by reference).
 * @returns Returns the stub source.
 */
function makeSource(): UnsavedWorkSource {
  return {
    dirtyDocuments: (): readonly UnsavedDocument[] => [],
    dirtyDocumentsFor: (): readonly UnsavedDocument[] => [],
    save: (): Promise<boolean> => Promise.resolve(true),
    release: (): void => undefined,
  };
}

describe('UnsavedWorkRegistry', () => {
  let staticSource: UnsavedWorkSource;
  let registry: UnsavedWorkRegistry;

  beforeEach(() => {
    staticSource = makeSource();
    TestBed.configureTestingModule({
      providers: [{ provide: UNSAVED_WORK, useValue: staticSource, multi: true }],
    });
    registry = TestBed.inject(UnsavedWorkRegistry);
  });

  it('sources_includesTheStaticContributions', () => {
    expect(registry.sources()).toEqual([staticSource]);
  });

  it('register_appendsADynamicSourceAfterTheStaticOnes', () => {
    const dynamic: UnsavedWorkSource = makeSource();

    registry.register(dynamic);

    const sources: readonly UnsavedWorkSource[] = registry.sources();
    expect(sources.length).toBe(2);
    expect(sources[0]).toBe(staticSource);
    expect(sources[1]).toBe(dynamic);
  });

  it('register_dynamicSources_areReturnedInRegistrationOrder', () => {
    const first: UnsavedWorkSource = makeSource();
    const second: UnsavedWorkSource = makeSource();

    registry.register(first);
    registry.register(second);

    expect(registry.sources()).toEqual([staticSource, first, second]);
  });

  it('register_disposer_removesTheDynamicSource', () => {
    const dynamic: UnsavedWorkSource = makeSource();
    const dispose: () => void = registry.register(dynamic);

    dispose();

    expect(registry.sources()).toEqual([staticSource]);
  });
});
