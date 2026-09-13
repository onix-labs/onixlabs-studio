import { describe, expect, it } from 'vitest';
import {
  GLOBAL_SCOPE,
  PromptScope,
  readPromptScope,
  scopeMatches,
  scopeSpecificity,
  sortByScope,
} from './ai-prompt-scope';

describe('scopeMatches', () => {
  it('scopeMatches_whenScopeIsGlobal_matchesEverySurface', () => {
    expect(scopeMatches(GLOBAL_SCOPE, 'terminal', null)).toBe(true);
    expect(scopeMatches(GLOBAL_SCOPE, 'editor', 'csharp')).toBe(true);
  });

  it('scopeMatches_whenSurfaceListed_matchesThatSurfaceOnly', () => {
    const scope: PromptScope = { surfaces: ['terminal', 'binary'], languages: [] };

    expect(scopeMatches(scope, 'terminal', null)).toBe(true);
    expect(scopeMatches(scope, 'editor', 'csharp')).toBe(false);
  });

  it('scopeMatches_whenLanguageListed_matchesEditorRunsInThatLanguage', () => {
    const scope: PromptScope = { surfaces: [], languages: ['csharp'] };

    expect(scopeMatches(scope, 'editor', 'csharp')).toBe(true);
    expect(scopeMatches(scope, 'editor', 'markdown')).toBe(false);
  });

  it('scopeMatches_whenLanguageListed_ignoresCase', () => {
    const scope: PromptScope = { surfaces: [], languages: ['CSharp'] };

    expect(scopeMatches(scope, 'editor', 'csharp')).toBe(true);
  });

  it('scopeMatches_whenLanguageListedAndRunHasNone_doesNotMatch', () => {
    const scope: PromptScope = { surfaces: [], languages: ['csharp'] };

    expect(scopeMatches(scope, 'editor', null)).toBe(false);
    expect(scopeMatches(scope, 'terminal', null)).toBe(false);
  });

  it('scopeMatches_whenLanguageListedOnNonEditorSurface_doesNotMatch', () => {
    const scope: PromptScope = { surfaces: ['terminal'], languages: ['shell'] };

    expect(scopeMatches(scope, 'terminal', 'shell')).toBe(false);
  });
});

describe('scopeSpecificity', () => {
  it('scopeSpecificity_ranksGlobalThenSurfaceThenLanguage', () => {
    const global: number = scopeSpecificity(GLOBAL_SCOPE);
    const surface: number = scopeSpecificity({ surfaces: ['editor'], languages: [] });
    const language: number = scopeSpecificity({ surfaces: [], languages: ['csharp'] });
    const both: number = scopeSpecificity({ surfaces: ['editor'], languages: ['csharp'] });

    expect(global).toBeLessThan(surface);
    expect(surface).toBeLessThan(language);
    expect(language).toBeLessThan(both);
  });
});

describe('sortByScope', () => {
  it('sortByScope_ordersLeastSpecificFirstAndKeepsInputOrderAmongEquals', () => {
    const items: readonly { name: string; scope: PromptScope }[] = [
      { name: 'lang', scope: { surfaces: [], languages: ['csharp'] } },
      { name: 'global-a', scope: GLOBAL_SCOPE },
      { name: 'surface', scope: { surfaces: ['editor'], languages: [] } },
      { name: 'global-b', scope: GLOBAL_SCOPE },
    ];

    const ordered: string[] = sortByScope(items, (item): PromptScope => item.scope).map(
      (item): string => item.name,
    );

    expect(ordered).toEqual(['global-a', 'global-b', 'surface', 'lang']);
  });
});

describe('readPromptScope', () => {
  it('readPromptScope_whenValueIsNotAnObject_returnsGlobal', () => {
    expect(readPromptScope(null)).toEqual(GLOBAL_SCOPE);
    expect(readPromptScope('editor')).toEqual(GLOBAL_SCOPE);
  });

  it('readPromptScope_dropsUnknownSurfacesAndBlankLanguages', () => {
    const scope: PromptScope = readPromptScope({
      surfaces: ['editor', 'kitchen', 'editor'],
      languages: [' CSharp ', '', 7, 'markdown'],
    });

    expect(scope).toEqual({ surfaces: ['editor'], languages: ['csharp', 'markdown'] });
  });
});
