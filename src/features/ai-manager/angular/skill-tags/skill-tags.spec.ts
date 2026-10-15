import { describe, expect, it } from 'vitest';
import { splitSkillTags } from './skill-tags';

describe('splitSkillTags', () => {
  it('putsEditorLanguagesInTheScope_theRestInTechnologies_andKeepsUnlistedIds', () => {
    // #962: a language narrows the editor and is a tag besides; a technology is a tag alone; an id
    // written by hand that the list does not offer is kept where it was.
    expect(
      splitSkillTags(['typescript', 'angular'], ['hand-language'], ['hand-technology', 'react']),
    ).toEqual({
      languages: ['typescript', 'hand-language'],
      technologies: ['angular', 'hand-technology'],
    });
  });
});
