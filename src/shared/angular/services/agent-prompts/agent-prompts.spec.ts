import { TestBed } from '@angular/core/testing';

import { AgentPrompts } from './agent-prompts';

describe('AgentPrompts', () => {
  let prompts: AgentPrompts;

  beforeEach(() => {
    localStorage.clear();
    prompts = TestBed.inject(AgentPrompts);
  });

  it('save_whenNamed_slugifiesAndPersistsAcrossInstances', () => {
    expect(prompts.save('Code Review!', 'Review this code for bugs.')).toBe(true);

    expect(prompts.prompts()).toHaveLength(1);
    expect(prompts.prompts()[0].name).toBe('code-review');
    expect(prompts.prompts()[0].text).toBe('Review this code for bugs.');

    // A fresh instance rehydrates from the store.
    TestBed.resetTestingModule();
    const fresh: AgentPrompts = TestBed.inject(AgentPrompts);
    expect(fresh.prompts()).toHaveLength(1);
    expect(fresh.prompts()[0].name).toBe('code-review');
  });

  it('save_whenTheNameExists_overwritesTheText', () => {
    prompts.save('review', 'first');
    prompts.save('review', 'second');

    expect(prompts.prompts()).toHaveLength(1);
    expect(prompts.prompts()[0].text).toBe('second');
  });

  it('save_whenNameOrTextIsBlank_refuses', () => {
    expect(prompts.save('  !! ', 'text')).toBe(false);
    expect(prompts.save('name', '   ')).toBe(false);
    expect(prompts.prompts()).toHaveLength(0);
  });

  it('delete_whenCalled_removesThePrompt', () => {
    prompts.save('review', 'text');
    const id: string = prompts.prompts()[0].id;

    prompts.delete(id);

    expect(prompts.prompts()).toHaveLength(0);
  });
});
