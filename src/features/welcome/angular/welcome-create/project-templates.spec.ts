import {
  PROJECT_TEMPLATE_GROUPS,
  PROJECT_TEMPLATES,
  ProjectTemplate,
  ProjectTemplateGroup,
} from './project-templates';

describe('PROJECT_TEMPLATES', () => {
  it('everyTemplate_hasItsOwnSkill', () => {
    const skills: string[] = PROJECT_TEMPLATES.map(
      (template: ProjectTemplate): string => template.skill,
    );
    expect(new Set(skills).size).toBe(skills.length);
    expect(skills.every((skill: string): boolean => /^new-[a-z0-9-]+$/.test(skill))).toBe(true);
  });

  it('everyGroup_holdsATemplate', () => {
    for (const group of PROJECT_TEMPLATE_GROUPS) {
      expect(
        PROJECT_TEMPLATES.some((template: ProjectTemplate): boolean => template.group === group.id),
      ).toBe(true);
    }
  });

  it('everyGoal_readsAfterIWantToBuild', () => {
    // "I want to build <goal>." — a lower-case noun phrase, never a sentence of its own.
    for (const template of PROJECT_TEMPLATES) {
      expect(template.goal).toMatch(/^(a|an|infrastructure|embedded) /);
      expect(template.goal.endsWith('.')).toBe(false);
    }
  });

  it('groups_areInTheirOwnOrder', () => {
    expect(PROJECT_TEMPLATE_GROUPS.map((group: ProjectTemplateGroup): string => group.id)[0]).toBe(
      'applications',
    );
  });
});
